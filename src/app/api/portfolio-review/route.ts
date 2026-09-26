import { auth } from "@/auth";
import { reviewPortfolio, ReviewLimitError } from "@/lib/insights";

export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await reviewPortfolio(session.user.id));
  } catch (err) {
    if (err instanceof ReviewLimitError) return Response.json({ error: err.message }, { status: 429 });
    console.error("portfolio review failed", err);
    return Response.json({ error: "The AI review is unavailable right now. Please try again." }, { status: 502 });
  }
}
