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
      style: {
        heading: "Стиль ответа",
        triggerAria: "Сменить стиль ответа",
        currentLabel: (label: string) => `Стиль: ${label}`,
      },
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
      sources:     "Источники",
      collapseAria: "Свернуть список источников",
      expandAria:   "Развернуть список источников",
      pillHint:     "Открыть карточку источника",
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
    sources: {
      back:  "В чат",
      title: "Об источниках",
      lede:
        "Логос Патрум — поисково-цитатный ассистент по русскому святоотеческому наследию. Эта страница объясняет, откуда взяты тексты и на каких принципах построен проект.",
      origin: {
        heading: "Источник корпуса",
        paragraphs: [
          "Корпус Логос Патрум полностью построен на материалах одной библиотеки — Отечник православного портала «Азбука веры» (azbyka.ru). Все цитируемые в чате творения Святых Отцов взяты оттуда. Иных источников у проекта нет.",
          "К каждой выводимой цитате прикреплена прямая ссылка на соответствующую страницу первоисточника на azbyka.ru: одним кликом читатель переходит к полному тексту в оригинальной публикации. Внутри ответа отображается короткий фрагмент, по запросу можно открыть полный параграф со ссылкой.",
        ],
      },
      principles: {
        heading: "Принципы проекта",
        items: [
          "Открытый исходный код. Весь код опубликован на GitHub — любой может проверить, что и как используется.",
          "Свободный доступ. Без рекламы, платных тарифов и ограничений по числу запросов.",
          "Некоммерческий характер. Расходы на серверы и языковую модель автор несёт лично. Если в будущем эти расходы станут неподъёмными, я допускаю приём добровольных пожертвований исключительно на покрытие инфраструктуры — без введения платных функций.",
          "Прозрачная атрибуция. Автор, труд и ссылка на оригинальную публикацию указаны для каждой цитаты.",
          "Не замена чтению Отцов. Цель проекта — помочь сориентироваться в патристическом наследии и вернуть читателя к первоисточнику, а не подменить его кратким пересказом.",
        ],
      },
      rights: {
        heading: "Правообладателям переводов",
        paragraphs: [
          "Если вы — переводчик, наследник переводчика, издатель или иной правообладатель русского перевода текста, размещённого на azbyka.ru и попавшего в наш корпус, и не согласны с тем, что фрагменты этого перевода доступны через Логос Патрум, — напишите нам, и мы оперативно удалим соответствующий текст из корпуса.",
          "В письме укажите, пожалуйста, имя/название правообладателя, перевод (автор и труд) и любую дополнительную информацию для идентификации. По умолчанию подтверждение и отчёт об удалении отправим тем же письмом.",
        ],
        contactLabel: "Контакт",
        contactEmail: "kortev.yura1@gmail.com",
      },
      legal: {
        heading: "Юридическая основа",
        intro:
          "Используются нормы российского законодательства об интеллектуальных правах, применимые к нашему режиму работы:",
        items: [
          "Свободное цитирование (ст. 1274 ГК РФ) — короткие фрагменты в учебных, научных и информационных целях с обязательным указанием автора и источника.",
          "Использование материалов БД в личных, научных и образовательных целях (ст. 1335.1 ГК РФ) — с указанием источника и без коммерческой цели.",
          "Тексты Святых Отцов в оригинальных языках (греческий, латинский, церковнославянский) давно находятся в общественном достоянии; авторские права на современные русские переводы охраняются 70 лет после смерти переводчика (ст. 1281 ГК РФ).",
        ],
        disclaimer:
          "Если вы обнаружили в корпусе текст, по которому вы являетесь правообладателем и не желаете его присутствия — используйте контакт выше; мы реагируем без бюрократии.",
      },
      gratitude: {
        heading: "С благодарностью",
        body:
          "Фонду «Азбука веры» и редакции библиотеки Отечник — за многолетний труд по собранию, оцифровке и публикации творений Отцов Церкви. Без этой работы такой проект был бы невозможен.",
      },
      colophon: "Логос Патрум · открытый некоммерческий проект",
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
      style: {
        heading: "Response style",
        triggerAria: "Change response style",
        currentLabel: (label: string) => `Style: ${label}`,
      },
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
      sources:     "Sources",
      collapseAria: "Collapse sources list",
      expandAria:   "Expand sources list",
      pillHint:     "Open source card",
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
    sources: {
      back:  "To chat",
      title: "About the Sources",
      lede:
        "Logos Patrum is a search-and-quotation assistant for the Russian Orthodox patristic heritage. This page explains where the texts come from and the principles the project rests on.",
      origin: {
        heading: "Source of the Corpus",
        paragraphs: [
          "The Logos Patrum corpus is built entirely from a single library — Otechnik at the Russian Orthodox portal “Azbyka Very” (azbyka.ru). Every patristic work cited in the chat is sourced from there. The project uses no other source.",
          "Each quotation displayed in the interface carries a direct link to the corresponding page on azbyka.ru: one click takes the reader to the full text in its original publication. A short fragment is shown inline; the full paragraph with the link can be expanded on request.",
        ],
      },
      principles: {
        heading: "Project Principles",
        items: [
          "Open source. The entire codebase is published on GitHub — anyone can audit what is used and how.",
          "Free access. No ads, no paid tiers, no query limits.",
          "Non-commercial. Server and language-model costs are paid by the author personally. If, in the future, those costs become unsustainable, the project may accept voluntary donations strictly for infrastructure — never for paid features.",
          "Transparent attribution. Author, work, and a link to the original publication are shown for every quotation.",
          "Not a replacement for reading the Fathers. The goal is to help readers orient themselves in the patristic heritage and to lead them back to the primary sources, not to substitute a brief summary for the originals.",
        ],
      },
      rights: {
        heading: "For Translation Rights Holders",
        paragraphs: [
          "If you are a translator, an heir of a translator, a publisher, or otherwise a rights holder of a Russian translation hosted on azbyka.ru that has been included in our corpus, and you object to fragments of that translation being available through Logos Patrum — please write to us and we will promptly remove the corresponding text from the corpus.",
          "In your message, please include: the rights holder's name, the translation (author and work), and any further identifying details. Confirmation and a removal report will be sent in reply by default.",
        ],
        contactLabel: "Contact",
        contactEmail: "kortev.yura1@gmail.com",
      },
      legal: {
        heading: "Legal Basis",
        intro:
          "We rely on the following provisions of Russian intellectual-property law as applicable to our mode of operation:",
        items: [
          "Free quotation (Art. 1274 of the Civil Code of the Russian Federation) — short fragments for educational, scholarly, and informational purposes with mandatory attribution to author and source.",
          "Use of database materials for personal, scholarly, and educational purposes (Art. 1335.1) — with source attribution and without commercial intent.",
          "Patristic texts in their original languages (Greek, Latin, Church Slavonic) have long been in the public domain; copyrights on modern Russian translations are protected for 70 years after the translator's death (Art. 1281).",
        ],
        disclaimer:
          "If you find in our corpus a text to which you hold the rights and to which you object — use the contact above; we respond without bureaucracy.",
      },
      gratitude: {
        heading: "With Gratitude",
        body:
          "To the “Azbyka Very” Foundation and the editors of the Otechnik library — for many years of work collecting, digitising, and publishing the writings of the Fathers of the Church. Without that labour, this project would be impossible.",
      },
      colophon: "Logos Patrum · open, non-commercial project",
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
