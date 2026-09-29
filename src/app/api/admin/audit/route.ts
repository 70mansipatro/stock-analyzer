import { audit } from "@/lib/audit";
import { auditLogCsv, parseFilters } from "@/lib/audit-log";
import { AccessError, requirePermission } from "@/lib/authz";

/** CSV download of the audit log with the same filters as the admin tab (max 10,000 rows). */
export async function GET(req: Request) {
  let actor;
  try {
    actor = await requirePermission("admin.view");
  } catch (err) {
    return new Response(err instanceof AccessError ? err.message : "Forbidden", { status: 403 });
  }
  const filters = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  const { csv, count } = await auditLogCsv(filters);
  await audit(actor.id, "admin_audit_exported", { rows: count, ...filters });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
