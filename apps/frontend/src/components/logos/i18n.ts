"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ru" | "en";

export const STRINGS = {
  ru: {
    tagline: "Orthodox Theological Research Assistant",
    brand:   "ΛΟΓΟΣ  ·  Theologica",
    sidebar: {
      historyAria: "История разговоров",
      history:     "История",
      newChat:     "Новый разговор",
      empty:       "История пуста. Задайте первый вопрос — он сохранится здесь.",
      home:        "На главную",
      exportAria:  "Экспортировать в Markdown",
      deleteAria:  "Удалить разговор",
      deleteTitle: "Удалить разговор?",
      deleteBody:  "Это действие нельзя отменить — все сообщения будут безвозвратно стёрты.",
      deleteConfirm: "Удалить",
      deleteCancel:  "Отмена",
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
    bottom: {
      corpus: "Корпус собран с azbyka.ru",
      github: "Open source",
      githubAria: "Открыть исходники на GitHub",
    },
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
      placeholderShort: "Спросите о вере…",
      sendAria:    "Отправить запрос",
      stopAria:    "Остановить",
      enterHint:   "↵  Отправить  ·  ⇧ ↵ Новая строка",
      safety:      "Цитаты приводятся с указанием источника",
      you:         "Вы —",
      regenerate: "Перегенерировать",
      regenerateAria: "Перегенерировать ответ",
      export:     "Экспорт",
      exportAria: "Экспортировать чат в Markdown",
      edit: "Изменить",
      editAria: "Изменить и переотправить",
      cancelEdit: "Отмена",
      saveEdit: "Сохранить",
      toBottom: "К концу",
      toBottomAria: "Прокрутить к последнему сообщению",
    },
    starters: [
      "Сущность и энергия у свт. Григория Паламы",
      "Считал ли блж. Августин, что вера и разум должны быть согласованы?",
      "Был ли свет Преображения тварным или нетварным?",
      "Милость или справедливость — что у Бога преобладает?",
    ],
    askAboutWork: (author: string, work: string) =>
      `Расскажи о труде «${work}» — ${author}. Какие ключевые темы и цитаты?`,
    citation: {
      contextShow: "развернуть контекст",
      contextHide: "скрыть контекст",
      notFound:    "Цитата не найдена",
      sourceLabel: "azbyka",
      showPassage: "Полный параграф",
      highlightNotFound: "(цитата не найдена в параграфе дословно)",
    },
    errors: {
      streamConnect:    "Не удалось подключиться к LangGraph",
      streamConnectDesc: (url: string) =>
        `Проверьте, что бэкенд запущен на ${url}.`,
      generic: "Произошла ошибка. Попробуйте ещё раз.",
    },
    connect: {
      trigger: "Подключить",
      triggerAria: "Подключить к своему агенту",
      title: "Подключи Patristica к своему агенту",
      blurb: "MCP-сервер с инструментами поиска по святоотеческой библиотеке. Бесплатно, без регистрации.",
      tabClaude: "Claude Code",
      tabJson: "Другие клиенты (JSON)",
      fullPluginLabel: "Полный плагин (плюс teo-search субагент и автотриггер-скилл):",
      rawMcpLabel: "или только MCP, без агента и скилла:",
      jsonBlurb: "Для Cursor, Cline, langchain и других — скопируй в свой mcpServers:",
      toolsList: "Доступные инструменты:",
      sourcesLink: "Исходники на GitHub",
      sourcesAria: "Открыть репозиторий плагина",
      copyAria: "Скопировать",
      copied: "Скопировано",
    },
    budget: {
      warning: (used: number, limit: number) =>
        `Осталось ${(limit - used).toFixed(0)} ₽ из дневного лимита ${limit.toFixed(0)} ₽. После 0 ₽ запросы будут отклонены до завтра.`,
      globalPaused: "Сервис временно приостановлен — превышен месячный бюджет. Возвращайтесь позже.",
      dismissAria: "Скрыть предупреждение",
    },
  },
  en: {
    tagline: "Orthodox Theological Research Assistant",
    brand:   "ΛΟΓΟΣ  ·  Theologica",
    sidebar: {
      historyAria: "Conversation history",
      history:     "History",
      newChat:     "New conversation",
      empty:       "History is empty. Ask your first question — it will be saved here.",
      home:        "Back to home",
      exportAria:  "Export to Markdown",
      deleteAria:  "Delete conversation",
      deleteTitle: "Delete this conversation?",
      deleteBody:  "This action cannot be undone — all messages will be permanently erased.",
      deleteConfirm: "Delete",
      deleteCancel:  "Cancel",
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
    bottom: {
      corpus: "Corpus sourced from azbyka.ru",
      github: "Open source",
      githubAria: "Open the source code on GitHub",
    },
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
      placeholderShort: "Ask about doctrine…",
      sendAria:    "Send query",
      stopAria:    "Stop",
      enterHint:   "↵  Send  ·  ⇧ ↵ Newline",
      safety:      "Quotations are given with their sources",
      you:         "You —",
      regenerate: "Regenerate",
      regenerateAria: "Regenerate the answer",
      export:     "Export",
      exportAria: "Export chat to Markdown",
      edit: "Edit",
      editAria: "Edit and resubmit",
      cancelEdit: "Cancel",
      saveEdit: "Save",
      toBottom: "To end",
      toBottomAria: "Scroll to the latest message",
    },
    starters: [
      "Essence and energies in St. Gregory Palamas",
      "Did Blessed Augustine believe faith and reason must agree?",
      "Was the Light of the Transfiguration created or uncreated?",
      "Mercy or justice — which prevails in God?",
    ],
    askAboutWork: (author: string, work: string) =>
      `Tell me about "${work}" by ${author}. What are the key themes and quotations?`,
    citation: {
      contextShow: "show context",
      contextHide: "hide context",
      notFound:    "Citation not found",
      sourceLabel: "source",
      showPassage: "Full paragraph",
      highlightNotFound: "(quote not found verbatim in paragraph)",
    },
    errors: {
      streamConnect:    "Cannot reach LangGraph",
      streamConnectDesc: (url: string) =>
        `Make sure the backend is running at ${url}.`,
      generic: "Something went wrong. Please try again.",
    },
    connect: {
      trigger: "Connect",
      triggerAria: "Connect to your agent",
      title: "Connect Patristica to your agent",
      blurb: "MCP server with patristic-corpus search tools. Free, no signup.",
      tabClaude: "Claude Code",
      tabJson: "Other clients (JSON)",
      fullPluginLabel: "Full plugin (with teo-search subagent and auto-trigger skill):",
      rawMcpLabel: "or just the MCP, no agent or skill:",
      jsonBlurb: "For Cursor, Cline, langchain, and others — paste into your mcpServers:",
      toolsList: "Available tools:",
      sourcesLink: "Source on GitHub",
      sourcesAria: "Open the plugin repository",
      copyAria: "Copy",
      copied: "Copied",
    },
    budget: {
      warning: (used: number, limit: number) =>
        `${(limit - used).toFixed(0)} ₽ left of today's ${limit.toFixed(0)} ₽ limit. At 0 ₽ requests are rejected until tomorrow.`,
      globalPaused: "Service is paused — monthly budget exceeded. Please come back later.",
      dismissAria: "Dismiss warning",
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
