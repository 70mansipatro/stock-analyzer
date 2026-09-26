import { auth } from "@/auth";
import { getMarketOverview } from "@/lib/market";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await getMarketOverview());
  } catch {
    return Response.json([], { status: 502 });
  }
}
