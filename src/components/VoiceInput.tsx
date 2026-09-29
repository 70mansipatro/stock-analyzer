"use client";

import { Check, Mic, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { stopSpeaking } from "@/lib/speech";
import { toast } from "@/lib/toast";

/**
 * Speech-to-text with the browser's Web Speech API (Chrome, Edge, Safari), plus a live sound wave
 * drawn from the microphone level. Firefox has no speech recognition, so the mic is disabled there.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const getCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const SILENCE_MS = 2200;
const noopSubscribe = () => () => {};

export function useVoiceInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const cancelled = useRef(false);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const cleanup = useCallback(() => {
    if (silence.current) clearTimeout(silence.current);
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    rec.current = null;
    setListening(false);
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);
  const cancel = useCallback(() => {
    cancelled.current = true;
    rec.current?.abort();
  }, []);

  const start = useCallback(async () => {
    const Ctor = getCtor();
    if (!Ctor) {
      toast("error", "Voice input isn't supported here", "Try Chrome, Edge or Safari.");
      return;
    }
    stopSpeaking();
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast("error", "Microphone blocked", "Allow microphone access in the browser's address bar, then try again.");
      return;
    }
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    finalText.current = "";
    cancelled.current = false;
    setTranscript("");

    // Finish automatically after a pause in speech.
    const armSilence = () => {
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(() => r.stop(), SILENCE_MS);
    };
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript((finalText.current + interim).trim());
      armSilence();
    };
    r.onerror = (e) => {
      if (e.error === "no-speech") toast("info", "Didn't catch that", "Tap the mic and try speaking again.");
      else if (e.error === "not-allowed") toast("error", "Microphone blocked", "Allow microphone access and try again.");
      else if (e.error !== "aborted") toast("error", "Voice input stopped", e.error.replace(/-/g, " "));
    };
    r.onend = () => {
      const text = finalText.current.trim() || "";
      const wasCancelled = cancelled.current;
      cleanup();
      setTranscript("");
      if (!wasCancelled && text) onFinalRef.current(text);
    };
    rec.current = r;
    setStream(media);
    setListening(true);
    try {
      r.start();
      armSilence();
    } catch {
      cleanup();
    }
  }, [cleanup]);

  useEffect(() => () => rec.current?.abort(), []);

  // Server render assumes support so the button doesn't change on hydration.
  const supported = useSyncExternalStore(noopSubscribe, () => getCtor() !== null, () => true);
  return { listening, transcript, stream, start, stop, cancel, supported };
}

/** Animated bars that follow the microphone's loudness. */
export function SoundWave({ stream, bars = 32 }: { stream: MediaStream | null; bars?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !stream) return;
    const ctx2d = el.getContext("2d");
    if (!ctx2d) return;
    const audio = new AudioContext();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Array(bars).fill(0);
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);
      analyser.getByteFrequencyData(data);
      const gap = 3;
      const bw = Math.max(2, (w - gap * (bars - 1)) / bars);
      const grad = ctx2d.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#34d399");
      grad.addColorStop(0.5, "#38bdf8");
      grad.addColorStop(1, "#a78bfa");
      ctx2d.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        // Voice lives in the lower bins; mirror them so the wave is symmetric around the centre.
        const mirrored = Math.abs(i - (bars - 1) / 2) / (bars / 2);
        const bin = Math.floor(mirrored * data.length * 0.45);
        const target = data[bin] / 255;
        levels[i] += (target - levels[i]) * 0.35;
        const bh = Math.max(3, levels[i] * h * 0.95);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, bw, bh, bw / 2);
        ctx2d.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void audio.close();
    };
  }, [stream, bars]);

  return <canvas ref={canvas} className="h-9 w-full" aria-hidden />;
}

/** Replaces the text box while listening: sound wave, live transcript, cancel and done. */
export function ListeningBar({ stream, transcript, onStop, onCancel }: { stream: MediaStream | null; transcript: string; onStop: () => void; onCancel: () => void }) {
  return (
    <div className="glass flex items-center gap-2 rounded-2xl border-emerald-400/40 p-1.5" role="status" aria-live="polite">
      <button type="button" onClick={onCancel} aria-label="Cancel voice input" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-ink/10 hover:text-slate-100">
        <X className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <SoundWave stream={stream} />
        <p className="truncate px-1 text-center text-xs text-slate-400">{transcript || "Listening… speak now"}</p>
      </div>
      <button type="button" onClick={onStop} aria-label="Done, send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 text-white shadow-lg transition hover:brightness-110">
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

export function MicButton({ onClick, disabled, supported }: { onClick: () => void; disabled?: boolean; supported: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Speak your question"
      title={supported ? "Speak your question" : "Voice input needs Chrome, Edge or Safari"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-ink/10 hover:text-emerald-300 disabled:opacity-30"
    >
      <Mic className="h-4.5 w-4.5" />
    </button>
  );
}
