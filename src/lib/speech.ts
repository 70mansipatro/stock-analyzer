"use client";

import { useSyncExternalStore } from "react";

/**
 * Text-to-speech for assistant replies, using the browser's built-in speechSynthesis (no server, no cost).
 * One reply plays at a time; `useSpeaking()` tells the UI which message is playing.
 */

const TTS_KEY = "chat-tts";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let speakingId: string | null = null;
let autoSpeak: boolean | null = null;

export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

function readAuto() {
  if (autoSpeak === null) {
    try {
      autoSpeak = localStorage.getItem(TTS_KEY) === "1";
    } catch {
      autoSpeak = false;
    }
  }
  return autoSpeak;
}

export function setAutoSpeak(on: boolean) {
  autoSpeak = on;
  try {
    localStorage.setItem(TTS_KEY, on ? "1" : "0");
  } catch {}
  if (!on) stopSpeaking();
  emit();
}

/** Whether replies are read aloud automatically (the speaker toggle). */
export const useAutoSpeak = () => useSyncExternalStore(subscribe, readAuto, () => false);
/** Id of the message being read aloud, if any. */
export const useSpeaking = () => useSyncExternalStore(subscribe, () => speakingId, () => null);

/** Markdown → plain sentences that sound natural when read. */
export function speakable(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // tables are shown, not read
    .replace(/[*_`#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\bUSD\b/g, "US dollars")
    .replace(/₹/g, " rupees ")
    .replace(/(\d)%/g, "$1 percent")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const lang = (navigator.language || "en-US").toLowerCase();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const sameLang = en.filter((v) => v.lang.toLowerCase() === lang);
  const nice = (v: SpeechSynthesisVoice) => /natural|neural|google|samantha|aria|jenny|rishi|veena/i.test(v.name);
  return sameLang.find(nice) ?? sameLang[0] ?? en.find(nice) ?? en[0] ?? voices[0] ?? null;
}

export function stopSpeaking() {
  if (!ttsSupported()) return;
  speechSynthesis.cancel();
  if (speakingId !== null) {
    speakingId = null;
    emit();
  }
}

/** Reads text aloud. Split into sentences because Chrome stops long utterances after ~15 seconds. */
export function speak(id: string, markdown: string) {
  if (!ttsSupported()) return;
  stopSpeaking();
  const text = speakable(markdown);
  if (!text) return;
  const chunks = text.match(/[^.!?]+[.!?]*\s*/g)?.reduce<string[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.length + s.length < 220) acc[acc.length - 1] = last + s;
    else acc.push(s);
    return acc;
  }, []) ?? [text];

  const voice = pickVoice();
  speakingId = id;
  emit();
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk.trim());
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1.03;
    if (i === chunks.length - 1) {
      u.onend = u.onerror = () => {
        if (speakingId === id) {
          speakingId = null;
          emit();
        }
      };
    }
    speechSynthesis.speak(u);
  });
}

// Voices load asynchronously in Chrome; touching the list early warms it up.
if (ttsSupported()) speechSynthesis.getVoices();
