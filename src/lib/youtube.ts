import "server-only";

/**
 * YouTube search for the AI assistant's "show me videos" answers.
 * Uses the YouTube Data API when YOUTUBE_API_KEY is set, otherwise reads YouTube's public results page.
 * Only video ids (validated) reach the browser, which embeds them from youtube-nocookie.com.
 */
export type Video = { id: string; title: string; channel: string; duration: string | null; views: string | null; published: string | null; thumbnail: string };

export class VideoError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const cache = new Map<string, { at: number; videos: Video[] }>();
const TTL = 6 * 60 * 60_000;

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function isoDuration(iso?: string) {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  return h ? `${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mi}:${String(s).padStart(2, "0")}`;
}

async function viaApi(query: string, count: number, key: string): Promise<Video[]> {
  const params = new URLSearchParams({ part: "snippet", q: query, type: "video", maxResults: String(count), safeSearch: "strict", videoEmbeddable: "true", relevanceLanguage: "en", key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new VideoError(`YouTube search failed (${res.status}).`);
  const data = (await res.json()) as { items?: { id: { videoId?: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }[] };
  const items = (data.items ?? []).filter((i) => i.id.videoId && ID_RE.test(i.id.videoId));
  // A second cheap call for durations and view counts.
  const details = new Map<string, { duration: string | null; views: string | null }>();
  if (items.length) {
    const d = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "contentDetails,statistics", id: items.map((i) => i.id.videoId!).join(","), key })}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    for (const v of (d?.items ?? []) as { id: string; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }[]) {
      const n = Number(v.statistics?.viewCount);
      details.set(v.id, { duration: isoDuration(v.contentDetails?.duration), views: Number.isFinite(n) ? `${Intl.NumberFormat("en", { notation: "compact" }).format(n)} views` : null });
    }
  }
  return items.map((i) => ({
    id: i.id.videoId!,
    title: decodeEntities(i.snippet.title),
    channel: i.snippet.channelTitle,
    published: i.snippet.publishedAt.slice(0, 10),
    duration: details.get(i.id.videoId!)?.duration ?? null,
    views: details.get(i.id.videoId!)?.views ?? null,
    thumbnail: thumb(i.id.videoId!),
  }));
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (r: unknown): string => {
  const o = r as { simpleText?: string; runs?: { text: string }[] } | undefined;
  return o?.simpleText ?? o?.runs?.map((x) => x.text).join("") ?? "";
};

/** Fallback without an API key: the results page embeds its data as JSON (ytInitialData). */
async function viaPage(query: string, count: number): Promise<Video[]> {
  const res = await fetch(`https://www.youtube.com/results?${new URLSearchParams({ search_query: query, sp: "EgIQAQ==" /* videos only */, hl: "en" })}`, {
    headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new VideoError("YouTube search is unavailable right now.");
  const html = await res.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (!m) throw new VideoError("YouTube search is unavailable right now.");
  const found: Video[] = [];
  const walk = (node: unknown) => {
    if (found.length >= count || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const v = (node as { videoRenderer?: Record<string, unknown> }).videoRenderer;
    if (v && typeof v.videoId === "string" && ID_RE.test(v.videoId)) {
      found.push({
        id: v.videoId,
        title: text(v.title),
        channel: text(v.ownerText),
        duration: text(v.lengthText) || null,
        views: text(v.shortViewCountText) || null,
        published: text(v.publishedTimeText) || null,
        thumbnail: thumb(v.videoId),
      });
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return found;
}

export async function searchVideos(rawQuery: string, count = 4): Promise<Video[]> {
  const query = rawQuery.trim().slice(0, 100);
  const key = `${query.toLowerCase()}|${count}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.videos;
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  let videos: Video[];
  try {
    videos = apiKey ? await viaApi(query, count, apiKey) : await viaPage(query, count);
  } catch (err) {
    if (err instanceof VideoError) throw err;
    console.error("video search failed", err);
    throw new VideoError("YouTube search is unavailable right now.");
  }
  if (!videos.length) throw new VideoError(`No videos found for "${query}".`);
  cache.set(key, { at: Date.now(), videos });
  return videos;
}
