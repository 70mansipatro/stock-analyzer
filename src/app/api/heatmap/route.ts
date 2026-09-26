import { auth } from "@/auth";
import { getHeatmap } from "@/lib/market";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const region = new URL(req.url).searchParams.get("region") === "IN" ? "IN" : "US";
  try {
    return Response.json(await getHeatmap(region));
  } catch {
    return Response.json([], { status: 502 });
  }
}
