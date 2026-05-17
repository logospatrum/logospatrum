/**
 * Client-side helper to read the per-request HMAC session token that the
 * server injected into `<meta name="pat-session">` during SSR.
 *
 * Symmetric with `apps/backend/src/backend/budget/session.py`. Sent on every
 * authenticated API call as the `X-Pat-Session` header.
 */
export function getPatSession(): string {
  if (typeof document === "undefined") return "";
  return (
    document
      .querySelector('meta[name="pat-session"]')
      ?.getAttribute("content") ?? ""
  );
}
