import { timingSafeEqual } from "node:crypto";
import { checkAlerts } from "@/lib/alerts";

/** For an external scheduler (e.g. Vercel Cron) when the server doesn't stay up: GET with "Authorization: Bearer $CRON_SECRET". */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await checkAlerts());
}
