"use client";

import { useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";
const KEY = "theme";

function resolve(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref) || "dark";
  } catch {
    return "dark";
  }
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  document.documentElement.dataset.theme = resolve(pref);
  window.dispatchEvent(new Event("app:theme"));
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onSystem = () => getThemePref() === "system" && setThemePref("system");
  mq.addEventListener("change", onSystem);
  window.addEventListener("app:theme", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onSystem);
    window.removeEventListener("app:theme", cb);
  };
}

/** The theme currently applied to the page. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
}

/** The user's saved preference (light / dark / system). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, () => "dark" as ThemePref);
}

/** Reads a CSS custom property from the root (for canvas charts that can't use CSS). */
export function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
