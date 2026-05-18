"use client";

import { useEffect, useState, useCallback } from "react";

/** Response-style presets shipped by the backend (mirror of
 *  `apps/backend/src/backend/styles/*.md`). The `id` MUST match the backend
 *  `name` frontmatter — it's forwarded as `config.configurable.style_id`. */
export type StyleId = "normal" | "academic" | "explanatory" | "concise";

export interface StylePreset {
  id: StyleId;
  label: { ru: string; en: string };
  tagline: { ru: string; en: string };
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "normal",
    label: { ru: "Обычный", en: "Normal" },
    tagline: { ru: "Без рамок", en: "No framing" },
  },
  {
    id: "academic",
    label: { ru: "Академический", en: "Academic" },
    tagline: { ru: "Строго, термины, структура", en: "Rigorous, term-precise" },
  },
  {
    id: "explanatory",
    label: { ru: "Объясняющий", en: "Explanatory" },
    tagline: {
      ru: "От знакомого к незнакомому, с аналогиями",
      en: "From familiar to unfamiliar",
    },
  },
  {
    id: "concise",
    label: { ru: "Лаконичный", en: "Concise" },
    tagline: {
      ru: "Минимум прозы, цитаты остаются",
      en: "Minimum prose, citations stay",
    },
  },
];

const STYLE_IDS = new Set<string>(STYLE_PRESETS.map((p) => p.id));
const DEFAULT_STYLE: StyleId = "normal";
const STYLE_STORAGE_KEY = "logos:style";

function readStored(): StyleId {
  if (typeof window === "undefined") return DEFAULT_STYLE;
  try {
    const v = localStorage.getItem(STYLE_STORAGE_KEY);
    if (v && STYLE_IDS.has(v)) return v as StyleId;
  } catch {
    /* localStorage may throw in privacy mode */
  }
  return DEFAULT_STYLE;
}

/** SSR-safe global style selection. Starts at `normal` on first render to
 *  match server-rendered HTML, then hydrates from localStorage in effect.
 *  Writes propagate to localStorage so the choice survives reloads and
 *  applies to every new submit globally (we deliberately don't scope
 *  per-thread). */
export function useStyle(): {
  styleId: StyleId;
  setStyleId: (id: StyleId) => void;
} {
  const [styleId, setStyleState] = useState<StyleId>(DEFAULT_STYLE);

  useEffect(() => {
    setStyleState(readStored());
  }, []);

  const setStyleId = useCallback((id: StyleId) => {
    setStyleState(id);
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, id);
    } catch {
      /* swallow */
    }
  }, []);

  return { styleId, setStyleId };
}

/** Exposed for the submit path: read the current style synchronously without
 *  React state (e.g. inside a useCallback that doesn't depend on the hook).
 *  Falls back to the default. */
export function getCurrentStyleId(): StyleId {
  return readStored();
}
