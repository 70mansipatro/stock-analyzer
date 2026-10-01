// A tiny in-memory stand-in for the Prisma client, covering the queries the auto-trader engine makes.
// Supports equality, in/notIn, gt/gte/lt/lte, not, startsWith, OR and unique idempotency keys.
import { Prisma } from "@/generated/prisma/client";

type Row = Record<string, unknown>;

const val = (v: unknown) => (v instanceof Prisma.Decimal ? v.toNumber() : v instanceof Date ? v.getTime() : v);

function matchField(actual: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date || cond instanceof Prisma.Decimal) return val(actual) === val(cond) || (cond === null && actual === undefined);
  const c = cond as Record<string, unknown>;
  const a = val(actual) as number | null | undefined;
  if ("in" in c && !(c.in as unknown[]).map(val).includes(a)) return false;
  if ("notIn" in c && (c.notIn as unknown[]).map(val).includes(a)) return false;
  if ("gte" in c && !(a !== null && a !== undefined && a >= (val(c.gte) as number))) return false;
  if ("gt" in c && !(a !== null && a !== undefined && a > (val(c.gt) as number))) return false;
  if ("lt" in c && !(a !== null && a !== undefined && a < (val(c.lt) as number))) return false;
  if ("lte" in c && !(a !== null && a !== undefined && a <= (val(c.lte) as number))) return false;
  if ("not" in c && val(c.not) === a) return false;
  if ("startsWith" in c && !(typeof actual === "string" && actual.startsWith(c.startsWith as string))) return false;
  return true;
}

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (k === "userId_symbol") return matches(row, cond as Row);
    return matchField(row[k], cond);
  });
}

let seq = 0;
const id = () => `id${++seq}`;

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Prisma.Decimal) && !Array.isArray(v) && ("increment" in v || "decrement" in v)) {
      const cur = Number(val(row[k]) ?? 0);
      row[k] = new Prisma.Decimal(cur + Number(val((v as Row).increment) ?? 0) - Number(val((v as Row).decrement) ?? 0));
    } else row[k] = v;
  }
  return row;
}

function table(name: string, db: { tables: Record<string, Row[]> }, unique: string[] = []) {
  const rows = () => db.tables[name];
  const uniqueCheck = (row: Row, self?: Row) => {
    for (const f of unique) {
      if (row[f] === null || row[f] === undefined) continue;
      if (rows().some((r) => r !== self && r[f] === row[f])) throw new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${f}`, { code: "P2002", clientVersion: "test" });
    }
  };
  const defaults: Row = name === "agentDecision" ? { quantity: 0, score: 0, confidence: 0 } : {};
  const t = {
    findMany: async (a: { where?: Row; include?: Row } = {}) => rows().filter((r) => matches(r, a.where)).map((r) => (a.include?.user ? { ...r, user: db.tables.user.find((u) => u.id === r.userId) } : r)),
    findFirst: async (a: { where?: Row } = {}) => rows().find((r) => matches(r, a.where)) ?? null,
    findUnique: async (a: { where: Row }) => rows().find((r) => matches(r, a.where)) ?? null,
    findUniqueOrThrow: async (a: { where: Row }) => {
      const r = rows().find((x) => matches(x, a.where));
      if (!r) throw new Error(`${name} not found`);
      return r;
    },
    count: async (a: { where?: Row } = {}) => rows().filter((r) => matches(r, a.where)).length,
    create: async (a: { data: Row }) => {
      const row = { id: id(), createdAt: new Date(), ...(name === "agentRun" ? { startedAt: new Date() } : {}), ...defaults, ...a.data };
      uniqueCheck(row);
      rows().push(row);
      return row;
    },
    createMany: async (a: { data: Row[] }) => {
      for (const d of a.data) await t.create({ data: d });
      return { count: a.data.length };
    },
    update: async (a: { where: Row; data: Row }) => {
      const r = rows().find((x) => matches(x, a.where));
      if (!r) throw new Error(`${name} to update not found`);
      uniqueCheck({ ...r, ...a.data }, r);
      return applyData(r, a.data);
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      const list = rows().filter((x) => matches(x, a.where));
      list.forEach((r) => applyData(r, a.data));
      return { count: list.length };
    },
    upsert: async (a: { where: Row; create: Row; update: Row }) => {
      const r = rows().find((x) => matches(x, a.where));
      return r ? applyData(r, a.update) : t.create({ data: a.create });
    },
    deleteMany: async (a: { where?: Row } = {}) => {
      const keep = rows().filter((r) => !matches(r, a.where));
      const count = rows().length - keep.length;
      db.tables[name] = keep;
      return { count };
    },
    groupBy: async (a: { by: string[]; where?: Row; _sum?: Row; _max?: Row }) => {
      const groups = new Map<string, Row[]>();
      for (const r of rows().filter((x) => matches(x, a.where))) {
        const k = a.by.map((b) => String(r[b])).join("|");
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      return [...groups.values()].map((g) => ({
        ...Object.fromEntries(a.by.map((b) => [b, g[0][b]])),
        _count: g.length,
        _sum: Object.fromEntries(Object.keys(a._sum ?? {}).map((f) => [f, g.reduce((s, r) => s + Number(val(r[f]) ?? 0), 0)])),
        _max: Object.fromEntries(Object.keys(a._max ?? {}).map((f) => [f, g.map((r) => r[f]).sort().at(-1)])),
      }));
    },
    aggregate: async (a: { where?: Row; _sum?: Row }) => {
      const list = rows().filter((r) => matches(r, a.where));
      return { _count: list.length, _sum: Object.fromEntries(Object.keys(a._sum ?? {}).map((f) => [f, list.reduce((s, r) => s + Number(val(r[f]) ?? 0), 0)])) };
    },
  };
  return t;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

export function createFakeDb() {
  const db = { tables: { agentConfig: [], agentRun: [], agentDecision: [], agentPosition: [], trade: [], holding: [], user: [], notification: [] } as Record<string, Row[]> };
  const client = {
    tables: db.tables,
    agentConfig: table("agentConfig", db),
    agentRun: table("agentRun", db),
    agentDecision: table("agentDecision", db, ["idempotencyKey"]),
    agentPosition: table("agentPosition", db),
    trade: table("trade", db),
    holding: table("holding", db),
    user: table("user", db),
    notification: table("notification", db),
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
  };
  return client;
}
