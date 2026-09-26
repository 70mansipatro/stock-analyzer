"use client";

import { ChevronDown, Maximize2, Minus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AssistantMark } from "@/components/AssistantMark";
import { Chat } from "@/components/Chat";

const SEEN_KEY = "chat-widget-seen";
const seenListeners = new Set<() => void>();
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
  seenListeners.forEach((l) => l());
};
const subscribeSeen = (l: () => void) => {
  seenListeners.add(l);
  return () => seenListeners.delete(l);
};

/** Floating AI assistant, bottom-right on every page. The conversation stays alive while the panel is closed. */
export function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Server render assumes "seen" so the first-visit hint never flashes during hydration.
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => true);
  const [hintGone, setHintGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHintGone(true), 7000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setMounted(true);
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (pathname.startsWith("/assistant")) return null;

  const toggle = () => {
    setMounted(true);
    setOpen((o) => !o);
    if (!seen) markSeen();
  };

  return (
    <>
      {mounted && (
        <div
          role="dialog"
          aria-label="AI assistant"
          hidden={!open}
          className="animate-pop-in fixed inset-x-3 bottom-36 top-20 z-50 flex flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-2/95 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:top-auto sm:h-[min(640px,calc(100dvh-8rem))] sm:w-[420px] lg:bottom-24"
        >
          <div className="relative flex items-center gap-3 border-b border-ink/5 px-4 py-3">
            <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-sky-500/10 to-violet-500/10" />
            <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-3 text-emerald-300 ring-1 ring-ink/10">
              <AssistantMark className="h-6 w-6" animated />
            </span>
            <div className="relative min-w-0 flex-1">
              <div className="text-sm font-semibold">AI Assistant</div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Gemini · 8 market tools · guardrails on
              </div>
            </div>
            <Link href="/assistant" onClick={() => setOpen(false)} aria-label="Open full screen" className="relative rounded-lg p-2 text-slate-400 hover:bg-ink/5 hover:text-slate-50">
              <Maximize2 className="h-4 w-4" />
            </Link>
            <button onClick={() => setOpen(false)} aria-label="Minimise" className="relative rounded-lg p-2 text-slate-400 hover:bg-ink/5 hover:text-slate-50">
              <Minus className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <Chat variant="widget" />
          </div>
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-50 flex items-center gap-3 sm:right-6 lg:bottom-6">
        {!seen && !open && !hintGone && (
          <div className="animate-fade-up hidden rounded-2xl border border-ink/10 bg-surface-2 px-3.5 py-2 text-sm text-slate-200 shadow-xl sm:block">
            Ask me about any stock <span className="text-slate-500">· Ctrl J</span>
          </div>
        )}
        <button
          onClick={toggle}
          aria-label={open ? "Close AI assistant" : "Open AI assistant"}
          aria-expanded={open}
          className="group relative rounded-full p-[1.5px] shadow-[0_10px_40px_-8px_rgba(56,189,248,0.55)] transition hover:-translate-y-0.5 active:translate-y-0"
        >
          <span aria-hidden className="launcher-ring absolute inset-0 rounded-full" />
          <span className="relative flex h-14 items-center gap-2.5 rounded-full bg-[#070b16] pl-2 pr-2 sm:pr-5">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 via-sky-500/15 to-violet-500/20 text-emerald-300">
              {open ? <ChevronDown className="h-5 w-5 text-slate-200" /> : <AssistantMark className="h-6 w-6" animated />}
              {!open && (
                <span className="absolute right-0.5 top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[#070b16] bg-emerald-400" />
                </span>
              )}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-semibold text-white">{open ? "Close" : "Ask AI"}</span>
              <span className="block text-[10px] text-slate-400">{open ? "Esc" : "Market copilot"}</span>
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
