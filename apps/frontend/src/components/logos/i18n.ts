"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ru" | "en";

export const STRINGS = {
  ru: {
    tagline: "Theological Research Assistant",
    brand:   "ΛΟΓΟΣ  ·  Theologica",
    sidebar: {
      historyAria: "История разговоров",
      history:     "История",
      newChat:     "Новый разговор",
      empty:       "История пуста. Задайте первый вопрос — он сохранится здесь.",
      home:        "На главную",
    },
    top: {
      homeLabel:    "Новый разговор",
      homeAria:     "Вернуться на главную",
      lightLabel:   "Свет",
      lightOnAria:  "Выключить свет",
      lightOffAria: "Включить свет",
      langAria:     "Сменить язык",
      libraryAria:  "Открыть библиотеку",
      libraryLabel: "Корпус",
    },
    bottom: { corpus: "Patristic Corpus · azbyka.ru" },
    quote: {
      line1: "…если они умолкнут,",
      line2: "то камни возопиют.",
      ref:   "Лк. 19 : 40",
    },
    tool:  { args: "Аргументы", result: "Результат" },
    thinking: {
      stepOf:    (i: number, n: number) => `Размышление · шаг ${i} из ${n}`,
      done:      (n: number) =>
        `Размышление · ${n} ${n === 1 ? "шаг" : n >= 2 && n <= 4 ? "шага" : "шагов"}`,
      inProgress: "в работе…",
    },
    chat: {
      placeholder: "Спросите о вере, догматике или Священном Предании",
      sendAria:    "Отправить запрос",
      stopAria:    "Остановить",
      enterHint:   "↵  Отправить  ·  ⇧ ↵ Новая строка",
      safety:      "Цитаты приводятся с указанием источника",
      you:         "Вы —",
      regenerate: "Перегенерировать",
      regenerateAria: "Перегенерировать ответ",
    },
    starters: [
      "Сущность и энергия у свт. Григория Паламы",
      "Иконоборчество и VII Вселенский Собор",
      "Чин крещения у свт. Кирилла Иерусалимского",
      "Каппадокийцы о троичном богословии",
    ],
    askAboutWork: (author: string, work: string) =>
      `Расскажи о труде «${work}» — ${author}. Какие ключевые темы и цитаты?`,
    citation: {
      contextShow: "развернуть контекст",
      contextHide: "скрыть контекст",
      notFound:    "Цитата не найдена",
      sourceLabel: "azbyka",
    },
    errors: {
      streamConnect:    "Не удалось подключиться к LangGraph",
      streamConnectDesc: (url: string) =>
        `Проверьте, что бэкенд запущен на ${url}.`,
      generic: "Произошла ошибка. Попробуйте ещё раз.",
    },
  },
  en: {
    tagline: "Theological Research Assistant",
    brand:   "ΛΟΓΟΣ  ·  Theologica",
    sidebar: {
      historyAria: "Conversation history",
      history:     "History",
      newChat:     "New conversation",
      empty:       "History is empty. Ask your first question — it will be saved here.",
      home:        "Back to home",
    },
    top: {
      homeLabel:    "New conversation",
      homeAria:     "Back to home",
      lightLabel:   "Light",
      lightOnAria:  "Turn light off",
      lightOffAria: "Turn light on",
      langAria:     "Switch language",
      libraryAria:  "Open the corpus",
      libraryLabel: "Corpus",
    },
    bottom: { corpus: "Patristic Corpus · azbyka.ru" },
    quote: {
      line1: "…if these were silent,",
      line2: "the stones would cry out.",
      ref:   "Lk. 19 : 40",
    },
    tool:  { args: "Arguments", result: "Result" },
    thinking: {
      stepOf:    (i: number, n: number) => `Reasoning · step ${i} of ${n}`,
      done:      (n: number) =>
        `Reasoning · ${n} ${n === 1 ? "step" : "steps"}`,
      inProgress: "working…",
    },
    chat: {
      placeholder: "Ask about doctrine, councils, or sacred tradition",
      sendAria:    "Send query",
      stopAria:    "Stop",
      enterHint:   "↵  Send  ·  ⇧ ↵ Newline",
      safety:      "Quotations are given with their sources",
      you:         "You —",
      regenerate: "Regenerate",
      regenerateAria: "Regenerate the answer",
    },
    starters: [
      "Essence and energies in St. Gregory Palamas",
      "Iconoclasm and the Seventh Ecumenical Council",
      "The rite of baptism in St. Cyril of Jerusalem",
      "The Cappadocians on Trinitarian theology",
    ],
    askAboutWork: (author: string, work: string) =>
      `Tell me about "${work}" by ${author}. What are the key themes and quotations?`,
    citation: {
      contextShow: "show context",
      contextHide: "hide context",
      notFound:    "Citation not found",
      sourceLabel: "source",
    },
    errors: {
      streamConnect:    "Cannot reach LangGraph",
      streamConnectDesc: (url: string) =>
        `Make sure the backend is running at ${url}.`,
      generic: "Something went wrong. Please try again.",
    },
  },
} as const;

export type Strings = (typeof STRINGS)[Lang];

const LANG_STORAGE_KEY = "logos:lang";

// Anything that doesn't unambiguously look Russian falls through to English.
// Exported for unit tests. In runtime code go through `useLangState` instead.
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "ru";
  const tag = (navigator.language || (navigator as { userLanguage?: string }).userLanguage || "").toLowerCase();
  return /^ru\b/.test(tag) ? "ru" : "en";
}

interface LangCtx {
  lang: Lang;
  s: Strings;
  setLang: (l: Lang) => void;
}

export const LangContext = createContext<LangCtx>({
  lang: "ru",
  s: STRINGS.ru,
  setLang: () => {},
});

export function useLangState(): LangCtx {
  // SSR-safe: start at "ru" (matches <html lang="ru"> in layout.tsx) and
  // hydrate from localStorage/navigator after mount to avoid hydration
  // mismatch on the user's first paint.
  const [lang, setLangState] = useState<Lang>("ru");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY) as Lang | null;
      if (stored === "ru" || stored === "en") {
        setLangState(stored);
        return;
      }
    } catch {
      /* localStorage may throw in privacy mode */
    }
    setLangState(detectLang());
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      /* swallow */
    }
  };
  return useMemo(() => ({ lang, s: STRINGS[lang], setLang }), [lang]);
}

export function useStrings(): LangCtx {
  return useContext(LangContext);
}
