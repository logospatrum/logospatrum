import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `counterId` is captured at module load — so each scenario does
// `vi.resetModules()` and re-imports after stubbing env / window.

describe("reachGoal", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // jsdom gives us `window` here; tests adjust window.ym as needed.
    delete (window as { ym?: unknown }).ym;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as { ym?: unknown }).ym;
  });

  it("no-ops when NEXT_PUBLIC_YM_COUNTER_ID is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_YM_COUNTER_ID", "");
    const ym = vi.fn();
    (window as { ym?: unknown }).ym = ym;
    const { reachGoal } = await import("../metrika");
    reachGoal("question_asked");
    expect(ym).not.toHaveBeenCalled();
  });

  it("no-ops when window.ym is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_YM_COUNTER_ID", "109275789");
    const { reachGoal } = await import("../metrika");
    // Should not throw even though window.ym is undefined.
    expect(() => reachGoal("citation_opened")).not.toThrow();
  });

  it("calls window.ym with counterId, action and goal when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_YM_COUNTER_ID", "109275789");
    const ym = vi.fn();
    (window as { ym?: unknown }).ym = ym;
    const { reachGoal } = await import("../metrika");
    reachGoal("question_asked");
    expect(ym).toHaveBeenCalledWith(109275789, "reachGoal", "question_asked");
  });

  it("forwards params object when provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_YM_COUNTER_ID", "109275789");
    const ym = vi.fn();
    (window as { ym?: unknown }).ym = ym;
    const { reachGoal } = await import("../metrika");
    reachGoal("azbyka_clicked", { source: "panel" });
    expect(ym).toHaveBeenCalledWith(109275789, "reachGoal", "azbyka_clicked", {
      source: "panel",
    });
  });

  it("no-ops when env value is non-numeric", async () => {
    vi.stubEnv("NEXT_PUBLIC_YM_COUNTER_ID", "not-a-number");
    const ym = vi.fn();
    (window as { ym?: unknown }).ym = ym;
    const { reachGoal } = await import("../metrika");
    reachGoal("library_opened");
    expect(ym).not.toHaveBeenCalled();
  });
});
