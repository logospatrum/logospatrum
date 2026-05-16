import { describe, it, expect, afterEach } from "vitest";
import { detectLang } from "../i18n";

const originalNavigator = globalThis.navigator;

function setNavigatorLang(lang: string | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: { language: lang ?? "" },
    configurable: true,
  });
}

describe("detectLang", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("returns 'ru' for ru-RU", () => {
    setNavigatorLang("ru-RU");
    expect(detectLang()).toBe("ru");
  });

  it("returns 'ru' for plain 'ru'", () => {
    setNavigatorLang("ru");
    expect(detectLang()).toBe("ru");
  });

  it("returns 'en' for en-US", () => {
    setNavigatorLang("en-US");
    expect(detectLang()).toBe("en");
  });

  it("returns 'en' for any non-russian tag (uk-UA, kk, etc.)", () => {
    setNavigatorLang("uk-UA");
    expect(detectLang()).toBe("en");
    setNavigatorLang("kk");
    expect(detectLang()).toBe("en");
    setNavigatorLang("zh-CN");
    expect(detectLang()).toBe("en");
  });

  it("returns 'en' when navigator.language is empty", () => {
    setNavigatorLang("");
    expect(detectLang()).toBe("en");
  });

  it("does not match 'rus' (only ^ru\\b)", () => {
    // "rus-ru" lowercased: after matching ^ru, next char is 's' (word char),
    // so \b does NOT match — correctly returns 'en'.
    setNavigatorLang("rus-RU");
    expect(detectLang()).toBe("en");
  });

  it("case-insensitive: 'RU' → 'ru'", () => {
    setNavigatorLang("RU");
    expect(detectLang()).toBe("ru");
  });
});
