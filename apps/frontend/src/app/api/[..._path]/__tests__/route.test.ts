import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock globalThis.fetch so we can verify whether upstream was called and
// control what it returns.
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// IMPORTANT: import AFTER the fetch mock is in place. The route handler
// captures `fetch` at module evaluation time only for the BACKEND URL —
// it doesn't store a reference at top-level — so per-test mocking via
// vi.fn() works fine.
import { handle } from "../route";

// --- Test request builder ---

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

interface MkReqOpts {
  cookie?: string;
  session?: string;
  origin?: string;
  body?: string;
}

function mkRequest(method: Method, path: string, opts: MkReqOpts = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", `pat_uid=${opts.cookie}`);
  if (opts.session) headers.set("x-pat-session", opts.session);
  if (opts.origin) headers.set("origin", opts.origin);
  const cookieJar = opts.cookie
    ? { get: (k: string) => (k === "pat_uid" ? { value: opts.cookie } : undefined) }
    : { get: () => undefined };
  return {
    method,
    headers,
    nextUrl: { search: "" },
    cookies: cookieJar,
    text: async () => opts.body ?? "{}",
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Parameters<typeof handle>[0];
}

function mkParams(path: string) {
  return { params: Promise.resolve({ _path: path.split("/") }) };
}

// Stub `/budget/check` response that the runStart() helper requires.
function stubBudgetCheckOK() {
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/budget/check")) {
      return new Response(
        JSON.stringify({
          allowed: true,
          used_rub: 0,
          limit_rub: 500,
          warn: false,
          reset_at: "2099-01-01T00:00:00+03:00",
        }),
        { status: 200 },
      );
    }
    return new Response("ok", { status: 200 });
  });
}

describe("API proxy whitelist", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    process.env.PAT_SESSION_SECRET = "test-secret-64-chars-long-test-secret-64-chars-long-test-se";
    process.env.LANGGRAPH_API_URL = "http://backend:8000";
  });

  // --- Public paths (no HMAC required) ---

  it("forwards /info without HMAC", async () => {
    const res = await handle(mkRequest("GET", "info"), mkParams("info"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/info"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("forwards /catalog without HMAC", async () => {
    const res = await handle(mkRequest("GET", "catalog"), mkParams("catalog"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/catalog"),
      expect.anything(),
    );
  });

  it("forwards /openapi.json without HMAC", async () => {
    const res = await handle(mkRequest("GET", "openapi.json"), mkParams("openapi.json"));
    expect(res.status).toBe(200);
  });

  it("forwards /mcp without HMAC (the product feature)", async () => {
    const res = await handle(mkRequest("POST", "mcp", { body: '{"jsonrpc":"2.0"}' }), mkParams("mcp"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/mcp"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards /mcp/anything/deep without HMAC", async () => {
    const res = await handle(mkRequest("POST", "mcp/sse/sub"), mkParams("mcp/sse/sub"));
    expect(res.status).toBe(200);
  });

  // --- Blacklist by default (whitelist closes) ---

  it("404s /store/items (not in whitelist)", async () => {
    const res = await handle(mkRequest("PUT", "store/items"), mkParams("store/items"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s /runs/batch (not in whitelist)", async () => {
    const res = await handle(mkRequest("POST", "runs/batch"), mkParams("runs/batch"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s /runs/crons (not in whitelist)", async () => {
    const res = await handle(mkRequest("POST", "runs/crons"), mkParams("runs/crons"));
    expect(res.status).toBe(404);
  });

  it("404s /threads (list endpoint not whitelisted)", async () => {
    const res = await handle(mkRequest("GET", "threads"), mkParams("threads"));
    expect(res.status).toBe(404);
  });

  it("404s /a2a (not in whitelist)", async () => {
    const res = await handle(mkRequest("POST", "a2a"), mkParams("a2a"));
    expect(res.status).toBe(404);
  });

  it("404s /assistants/foo (not in whitelist)", async () => {
    const res = await handle(mkRequest("GET", "assistants/foo"), mkParams("assistants/foo"));
    expect(res.status).toBe(404);
  });

  // --- Authenticated run-start ---

  it("401s /runs/stream when no X-Pat-Session header", async () => {
    stubBudgetCheckOK();
    const res = await handle(
      mkRequest("POST", "runs/stream", { cookie: "abc", body: "{}" }),
      mkParams("runs/stream"),
    );
    expect(res.status).toBe(401);
  });

  it("401s /threads/abc-123/runs/stream when no session", async () => {
    stubBudgetCheckOK();
    const res = await handle(
      mkRequest("POST", "threads/abc-123/runs/stream", { cookie: "abc" }),
      mkParams("threads/abc-123/runs/stream"),
    );
    expect(res.status).toBe(401);
  });

  it("OPTIONS returns 204 (preflight passthrough)", async () => {
    const res = await handle(mkRequest("OPTIONS", "anything/at/all"), mkParams("anything/at/all"));
    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
