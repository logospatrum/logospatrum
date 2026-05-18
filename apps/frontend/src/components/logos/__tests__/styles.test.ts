import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { STYLE_PRESETS, getCurrentStyleId, type StyleId } from "../styles";

const STORAGE_KEY = "logos:style";

// jsdom env (`environment: "jsdom"` in vitest.config) gives us window +
// localStorage; we just need to clear between tests.
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("STYLE_PRESETS", () => {
  it("ships the four canonical presets in fixed order", () => {
    expect(STYLE_PRESETS.map((p) => p.id)).toEqual([
      "normal",
      "academic",
      "explanatory",
      "concise",
    ]);
  });

  it("every preset has ru + en label and tagline", () => {
    for (const p of STYLE_PRESETS) {
      expect(p.label.ru).toBeTruthy();
      expect(p.label.en).toBeTruthy();
      expect(p.tagline.ru).toBeTruthy();
      expect(p.tagline.en).toBeTruthy();
    }
  });
});

describe("getCurrentStyleId", () => {
  it("defaults to 'normal' when localStorage is empty", () => {
    expect(getCurrentStyleId()).toBe("normal");
  });

  it("returns the stored id when valid", () => {
    localStorage.setItem(STORAGE_KEY, "academic");
    expect(getCurrentStyleId()).toBe("academic");
  });

  it("falls back to 'normal' when stored value is an unknown id", () => {
    localStorage.setItem(STORAGE_KEY, "doesnotexist");
    expect(getCurrentStyleId()).toBe("normal");
  });

  it("falls back to 'normal' when stored value is an empty string", () => {
    localStorage.setItem(STORAGE_KEY, "");
    expect(getCurrentStyleId()).toBe("normal");
  });

  it("treats every shipped preset id as valid", () => {
    for (const p of STYLE_PRESETS) {
      localStorage.setItem(STORAGE_KEY, p.id);
      expect(getCurrentStyleId()).toBe(p.id satisfies StyleId);
    }
  });
});
