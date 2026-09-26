import { auth } from "@/auth";
import { searchSymbols } from "@/lib/market";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return Response.json(await searchSymbols(q));
  } catch {
    return Response.json([]);
  }
}
