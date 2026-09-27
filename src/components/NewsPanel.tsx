import { ErrorNote } from "@/components/ui";
import { getNewsInsight, type Sentiment } from "@/lib/insights";

const TAG: Record<Sentiment, { label: string; cls: string; icon: string }> = {
  positive: { label: "Positive", cls: "bg-emerald-500/10 text-emerald-400", icon: "▲" },
  negative: { label: "Negative", cls: "bg-red-500/10 text-red-400", icon: "▼" },
  neutral: { label: "Neutral", cls: "bg-slate-500/10 text-slate-300", icon: "●" },
};

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Server component: headlines + AI sentiment. Rendered inside <Suspense> so the page doesn't wait on the model. */
export async function NewsPanel({ symbol }: { symbol: string }) {
  let insight;
  try {
    insight = await getNewsInsight(symbol);
  } catch (err) {
    console.error("news insight failed", err);
    return <ErrorNote>News sentiment is unavailable right now.</ErrorNote>;
  }
  if (!insight.items.length)
    return <p className="text-sm text-slate-400">No recent headlines for {symbol} in the free Yahoo Finance feed. Smaller and non-US stocks often have little coverage.</p>;

  const counts = { positive: 0, negative: 0, neutral: 0 };
  insight.items.forEach((i) => counts[i.sentiment]++);
  const total = insight.items.length;
  const overall = TAG[insight.label];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${overall.cls}`}>
          <span aria-hidden>{overall.icon}</span> News tone: {overall.label}
        </span>
        <div className="flex h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`${counts.positive} positive, ${counts.neutral} neutral, ${counts.negative} negative headlines`}>
          <span className="bg-emerald-500" style={{ width: `${(counts.positive / total) * 100}%` }} />
          <span className="bg-slate-500" style={{ width: `${(counts.neutral / total) * 100}%` }} />
          <span className="bg-red-500" style={{ width: `${(counts.negative / total) * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-slate-400">
          {counts.positive} positive · {counts.neutral} neutral · {counts.negative} negative
        </span>
      </div>
      <p className="text-sm text-slate-300">{insight.summary}</p>
      <ul className="divide-y divide-slate-800">
        {insight.items.map((n) => {
          const tag = TAG[n.sentiment];
          return (
            <li key={n.id} className="flex gap-3 py-3">
              {n.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.thumbnail} alt="" className="h-14 w-20 shrink-0 rounded-md object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-14 w-20 shrink-0 rounded-md bg-slate-800" />
              )}
              <div className="min-w-0 flex-1">
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-medium text-slate-100 hover:text-emerald-300">
                  {n.title}
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${tag.cls}`}>
                    <span aria-hidden>{tag.icon}</span>
                    {tag.label}
                  </span>
                  <span>{n.publisher}</span>
                  <span>·</span>
                  <span>{timeAgo(n.publishedAt)}</span>
                </div>
                {n.reason && <p className="mt-1 text-xs text-slate-400">{n.reason}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">Ratings are made by AI from headlines only. It can be wrong; read the article before acting.</p>
    </div>
  );
}

export function NewsSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading news">
      <div className="h-8 w-60 animate-pulse rounded-lg bg-slate-800" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="h-14 w-20 animate-pulse rounded-md bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-800" />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">AI is reading the latest headlines…</p>
    </div>
  );
}
