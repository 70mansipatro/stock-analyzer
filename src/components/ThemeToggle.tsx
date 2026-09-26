"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePref, useTheme, useThemePref, type ThemePref } from "@/lib/theme";

/** Compact sun/moon button for the top bar. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setThemePref(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:text-slate-50"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const OPTIONS: { id: ThemePref; label: string; icon: typeof Sun; preview: string }[] = [
  { id: "light", label: "Light", icon: Sun, preview: "from-[#e8edf5] to-[#ffffff]" },
  { id: "dark", label: "Dark", icon: Moon, preview: "from-[#0b1222] to-[#04060d]" },
  { id: "system", label: "System", icon: Monitor, preview: "from-[#ffffff] via-[#8a94a6] to-[#04060d]" },
];

/** Large theme picker with previews, for the Settings page. */
export function ThemePicker() {
  const pref = useThemePref();
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => {
        const active = pref === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            onClick={() => setThemePref(o.id)}
            className={`rounded-2xl border p-3 text-left transition ${active ? "border-emerald-400/60 ring-2 ring-emerald-400/30" : "border-ink/10 hover:border-ink/20"}`}
          >
            <div className={`relative h-24 overflow-hidden rounded-xl bg-gradient-to-br ${o.preview} ring-1 ring-ink/10`}>
              <div className="absolute left-3 top-3 h-2 w-16 rounded-full bg-emerald-400/70" />
              <div className="absolute left-3 top-7 h-2 w-24 rounded-full bg-sky-400/50" />
              <div className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-gradient-to-br from-emerald-400 via-sky-500 to-violet-500" />
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm font-medium">
              <o.icon className="h-4 w-4 text-slate-400" /> {o.label}
              {active && <span className="ml-auto rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">Active</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
