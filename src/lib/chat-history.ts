"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage } from "@/lib/chat-tools";

/** Recent conversations kept in this browser (localStorage), newest first. */
export type SavedChat = { id: string; title: string; updatedAt: number; messages: ChatMessage[] };

const KEY = "chat-history-v1";
const MAX = 12;
const listeners = new Set<() => void>();
let cache: SavedChat[] | null = null;
const EMPTY: SavedChat[] = [];

function read(): SavedChat[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedChat[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: SavedChat[]) {
  let items = list.slice(0, MAX);
  // If storage is full, drop the oldest conversations until it fits.
  while (items.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      break;
    } catch {
      items = items.slice(0, -1);
    }
  }
  cache = items;
  listeners.forEach((l) => l());
}

export function titleOf(messages: ChatMessage[]) {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim() ?? "";
  return text.length > 48 ? text.slice(0, 47) + "…" : text || "New chat";
}

export function saveChat(id: string, messages: ChatMessage[]) {
  if (!messages.some((m) => m.role === "user")) return;
  const rest = read().filter((c) => c.id !== id);
  write([{ id, title: titleOf(messages), updatedAt: Date.now(), messages }, ...rest]);
}

export function deleteChat(id: string) {
  write(read().filter((c) => c.id !== id));
}

export function clearAllChats() {
  write([]);
}

export function getChat(id: string) {
  return read().find((c) => c.id === id);
}

export function useChatHistory(): SavedChat[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          cache = null;
          l();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    () => EMPTY,
  );
}

export const newChatId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
