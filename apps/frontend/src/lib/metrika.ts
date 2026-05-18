/**
 * Thin wrapper around Yandex Metrika's `window.ym(id, 'reachGoal', ...)`.
 *
 * The counter script itself is injected by `src/app/layout.tsx` only when
 * `NEXT_PUBLIC_YM_COUNTER_ID` is set at build time. This helper no-ops when
 * the script is absent (SSR, dev without the env var, ad-blocker), so call
 * sites don't need to guard.
 */

export type MetrikaGoal =
  | "question_asked"
  | "citation_opened"
  | "azbyka_clicked"
  | "library_opened";

const rawId = process.env.NEXT_PUBLIC_YM_COUNTER_ID;
const counterId = rawId ? Number(rawId) : NaN;

export function reachGoal(
  goal: MetrikaGoal,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(counterId)) return;
  if (typeof window.ym !== "function") return;
  if (params === undefined) {
    window.ym(counterId, "reachGoal", goal);
  } else {
    window.ym(counterId, "reachGoal", goal, params);
  }
}
