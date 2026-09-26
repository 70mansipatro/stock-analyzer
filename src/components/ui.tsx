import type { LucideIcon } from "lucide-react";

type Tone = "emerald" | "sky" | "violet" | "amber" | "rose" | "slate";
const TONE: Record<Tone, string> = {
  emerald: "from-emerald-500/25 to-emerald-500/5 text-emerald-300 ring-emerald-400/20",
  sky: "from-sky-500/25 to-sky-500/5 text-sky-300 ring-sky-400/20",
  violet: "from-violet-500/25 to-violet-500/5 text-violet-300 ring-violet-400/20",
  amber: "from-amber-500/25 to-amber-500/5 text-amber-300 ring-amber-400/20",
  rose: "from-rose-500/25 to-rose-500/5 text-rose-300 ring-rose-400/20",
  slate: "from-slate-400/20 to-slate-400/5 text-slate-300 ring-slate-400/20",
};

export function IconBadge({ icon: Icon, tone = "emerald", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ${TONE[tone]} ${size === "sm" ? "h-7 w-7" : "h-9 w-9"}`}>
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.2} />
    </span>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  tone = "emerald",
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: Tone;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <IconBadge icon={icon} tone={tone} size="sm" />}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
              {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Tiny trend line (server-renderable SVG). */
export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`);
  const color = up ? "#34d399" : "#f87171";
  const id = `sl-${up ? "u" : "d"}-${values.length}-${Math.round(values[0])}`;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${pts.join(" L")} L100,30 L0,30 Z`} fill={`url(#${id})`} />
      <path d={`M${pts.join(" L")}`} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = "emerald",
  trend,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  trend?: { values: number[]; up: boolean };
}) {
  return (
    <div className="glass group relative overflow-hidden rounded-2xl p-4 transition hover:-translate-y-0.5 hover:border-white/15">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        {icon && <IconBadge icon={icon} tone={tone} size="sm" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-sm tabular-nums">{sub}</div>}
      {trend && trend.values.length > 1 && (
        <div className="-mx-4 -mb-4 mt-2 opacity-80 transition group-hover:opacity-100">
          <Sparkline values={trend.values} up={trend.up} />
        </div>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">⚠ {children}</div>;
}

export function PageHeader({ title, subtitle, children }: { title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
