import { auth } from "@/auth";
import { CHART_RANGES, getCandles, MarketError, type ChartRange } from "@/lib/market";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const params = new URL(req.url).searchParams;
  const range = (CHART_RANGES as readonly string[]).includes(params.get("range") ?? "") ? (params.get("range") as ChartRange) : "6M";
  try {
    return Response.json(await getCandles(params.get("symbol") ?? "", range));
  } catch (err) {
    return Response.json({ error: err instanceof MarketError ? err.message : "Chart data unavailable." }, { status: 400 });
  }
}
