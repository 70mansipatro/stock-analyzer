"use client";

import { Copy, Download, Loader2, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

type Format = "square" | "wide";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "square", label: "Square", hint: "WhatsApp, Instagram" },
  { id: "wide", label: "Wide", hint: "LinkedIn, X" },
];

/** "Share" button + dialog: live preview of the portfolio image, then share, download or copy it. */
export function ShareCardButton({ returnPct }: { returnPct: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110"
      >
        <Share2 className="h-4 w-4" /> Share my returns
      </button>
      {open && <ShareDialog onClose={() => setOpen(false)} returnPct={returnPct} />}
    </>
  );
}

function ShareDialog({ onClose, returnPct }: { onClose: () => void; returnPct: number }) {
  const [format, setFormat] = useState<Format>("square");
  const [amounts, setAmounts] = useState(false);
  const [holdings, setHoldings] = useState(true);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const src = `/api/share-card?format=${format}&amounts=${amounts ? 1 : 0}&holdings=${holdings ? 1 : 0}`;
  const loading = loadedSrc !== src;
  const caption = `My virtual stock portfolio is ${returnPct >= 0 ? "up" : "down"} ${Math.abs(returnPct).toFixed(2)}% on Stock Analyzer 📈 Practising trading with virtual money.`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const getFile = async () => {
    const res = await fetch(src);
    if (!res.ok) throw new Error("Couldn't create the image.");
    const blob = await res.blob();
    return new File([blob], `my-portfolio-${format}.png`, { type: "image/png" });
  };

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast("error", "Sharing failed", (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run("download", async () => {
      const file = await getFile();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("success", "Image downloaded");
    });

  const share = () =>
    run("share", async () => {
      const file = await getFile();
      if (navigator.canShare?.({ files: [file] })) {
        // Phones open the share sheet with the image attached (WhatsApp, LinkedIn, Instagram…).
        await navigator.share({ files: [file], text: caption, title: "My portfolio" });
      } else {
        toast("info", "Sharing images isn't supported in this browser", "Downloading it instead. Attach it to your post.");
        await download();
      }
    });

  const copy = () =>
    run("copy", async () => {
      const file = await getFile();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
      toast("success", "Image copied", "Paste it into WhatsApp Web, LinkedIn or any chat.");
    });

  // Link-based sharing can't attach an image, so the image is downloaded first to be attached by hand.
  const openWith = (target: "whatsapp" | "linkedin") =>
    run(target, async () => {
      const file = await getFile();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      await navigator.clipboard.writeText(caption).catch(() => {});
      window.open(target === "whatsapp" ? `https://wa.me/?text=${encodeURIComponent(caption)}` : "https://www.linkedin.com/feed/?shareActive=true", "_blank", "noopener");
      toast("info", "Image downloaded", target === "linkedin" ? "Caption copied. Paste it and attach the image in LinkedIn." : "Attach the downloaded image in WhatsApp.");
    });

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-ink/10 px-3 py-2.5 hover:border-ink/20">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="peer sr-only" />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-ink/15 transition after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:bg-emerald-500 peer-checked:after:translate-x-4" />
    </label>
  );

  const action = "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Share your portfolio" className="max-h-[95dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-ink/10 bg-surface-1 p-5 shadow-2xl outline-none sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Share your returns</h2>
            <p className="text-xs text-slate-500">A picture of your virtual portfolio, ready for WhatsApp or LinkedIn.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-ink/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-[1fr_15rem]">
          <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-black/40 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={src}
              src={src}
              alt="Preview of your portfolio share image"
              onLoad={() => setLoadedSrc(src)}
              onError={() => setLoadedSrc(src)}
              className={`max-h-[60dvh] w-full rounded-xl object-contain shadow-2xl transition ${loading ? "opacity-40 blur-sm" : ""}`}
            />
            {loading && <Loader2 className="absolute h-7 w-7 animate-spin text-slate-300" />}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
              {FORMATS.map((f) => (
                <button key={f.id} onClick={() => setFormat(f.id)} className={`rounded-lg px-2 py-1.5 text-left transition ${format === f.id ? "bg-surface-2 shadow-sm" : "hover:bg-ink/5"}`}>
                  <span className="block text-sm font-medium">{f.label}</span>
                  <span className="block text-[10px] text-slate-500">{f.hint}</span>
                </button>
              ))}
            </div>
            {toggle(amounts, setAmounts, "Show amounts", "Off = percentages only")}
            {format === "square" && toggle(holdings, setHoldings, "Show top holdings", "Symbols and their returns")}

            <button onClick={share} disabled={!!busy} className={`${action} w-full bg-gradient-to-r from-violet-500 to-sky-500 text-white shadow-lg`}>
              {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Share…
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={download} disabled={!!busy} className={`${action} border border-ink/10 hover:bg-ink/5`}>
                <Download className="h-4 w-4" /> Save
              </button>
              <button onClick={copy} disabled={!!busy} className={`${action} border border-ink/10 hover:bg-ink/5`}>
                <Copy className="h-4 w-4" /> Copy
              </button>
              <button onClick={() => openWith("whatsapp")} disabled={!!busy} className={`${action} bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/25`}>
                WhatsApp
              </button>
              <button onClick={() => openWith("linkedin")} disabled={!!busy} className={`${action} bg-[#0A66C2]/15 text-[#4c9be8] hover:bg-[#0A66C2]/25`}>
                LinkedIn
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">On a phone, “Share…” attaches the image directly. On a computer, use Copy and paste it into the chat, or Save and attach it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
