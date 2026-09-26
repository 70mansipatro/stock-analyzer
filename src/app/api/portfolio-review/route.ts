import { AccessError, requirePermission } from "@/lib/authz";
import { reviewPortfolio, ReviewLimitError } from "@/lib/insights";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

export async function POST() {
  try {
    const actor = await requirePermission("ai.review");
    if (!(await getSettings()).aiEnabled) return Response.json({ error: "AI features are turned off by an administrator." }, { status: 503 });
    return Response.json(await reviewPortfolio(actor.id));
  } catch (err) {
    if (err instanceof AccessError) return Response.json({ error: err.message }, { status: 403 });
    if (err instanceof ReviewLimitError) return Response.json({ error: err.message }, { status: 429 });
    console.error("portfolio review failed", err);
    return Response.json({ error: "The AI review is unavailable right now. Please try again." }, { status: 502 });
  }
}
