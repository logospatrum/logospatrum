import { describe, it, expect } from "vitest";
import {
  extractMarkers,
  numberMarkers,
  stripTrailingPartialMarker,
} from "../citation-marker";

describe("stripTrailingPartialMarker", () => {
  it("returns text unchanged when no markers", () => {
    expect(stripTrailingPartialMarker("hello world")).toBe("hello world");
  });

  it("returns text unchanged when last marker is closed", () => {
    expect(
      stripTrailingPartialMarker("hello [[a/b/0001/p1|«q»]] world"),
    ).toBe("hello [[a/b/0001/p1|«q»]] world");
  });

  it("strips a half-typed marker at end of stream", () => {
    expect(
      stripTrailingPartialMarker("hello [[a/b/0001/p1|«сп"),
    ).toBe("hello ");
  });

  it("preserves closed markers before a trailing partial", () => {
    expect(
      stripTrailingPartialMarker(
        "first [[a/b/0001/p1|«q1»]] then [[c/d/0002/p2|«стр",
      ),
    ).toBe("first [[a/b/0001/p1|«q1»]] then ");
  });

  it("strips bare opening brackets at end", () => {
    expect(stripTrailingPartialMarker("text and [[")).toBe("text and ");
  });
});

describe("extractMarkers", () => {
  it("returns empty for plain text", () => {
    expect(extractMarkers("hello world")).toEqual([]);
  });

  it("extracts single marker with 1-based n", () => {
    expect(extractMarkers("hello [[a/b/0001/p1|«spal»]] world")).toEqual([
      { n: 1, slug: "a/b/0001/p1", quote: "spal" },
    ]);
  });

  it("numbers multiple markers in order of appearance", () => {
    expect(
      extractMarkers("a [[x/y/0001/p1|«q1»]] b [[x/y/0002/p3|«q2»]] c"),
    ).toEqual([
      { n: 1, slug: "x/y/0001/p1", quote: "q1" },
      { n: 2, slug: "x/y/0002/p3", quote: "q2" },
    ]);
  });

  it("ignores half-tokens (no closing ]])", () => {
    expect(extractMarkers("text [[x/y/0001/p1|«сп")).toEqual([]);
  });

  it("ignores malformed (no «»)", () => {
    expect(extractMarkers("text [[x/y/0001/p1|noQuote]] more")).toEqual([]);
  });
});

describe("numberMarkers", () => {
  it("rewrites single agent marker to internal form", () => {
    expect(numberMarkers("hello [[a/b/0001/p1|«q»]] world")).toBe(
      "hello [[#1|a/b/0001/p1|«q»]] world",
    );
  });

  it("numbers multiple markers in order", () => {
    expect(
      numberMarkers("a [[x/y/0001/p1|«q1»]] b [[x/y/0002/p3|«q2»]] c"),
    ).toBe("a [[#1|x/y/0001/p1|«q1»]] b [[#2|x/y/0002/p3|«q2»]] c");
  });

  it("leaves plain text untouched", () => {
    expect(numberMarkers("hello world")).toBe("hello world");
  });

  it("leaves half-tokens untouched", () => {
    expect(numberMarkers("text [[x/y/0001/p1|«сп")).toBe(
      "text [[x/y/0001/p1|«сп",
    );
  });
});
