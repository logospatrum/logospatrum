import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const SECRET = process.env.PAT_SESSION_SECRET ?? "";

// Public paths — forwarded without HMAC verify. MCP is the product feature;
// the others are diagnostic / public corpus index. See
// docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md
// section 2.
const PUBLIC_RE = /^(info|catalog(\/.*)?|openapi\.json|mcp(\/.*)?)$/;

// Run-start paths — full HMAC verify + budget guard + subject inject.
// Frontend uses stateless `runs/stream`. The threads/{id}/runs/stream
// variant is pre-allowed for future stateful threading.
const RUN_START_RE = /^(threads\/[^/]+\/)?runs\/stream$/;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function verifyHmac(patUid: string, token: string): boolean {
  if (!SECRET || !patUid || !token) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`cookie:${patUid}:${todayUtc()}`)
    .digest("base64url");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function subjectKeyFor(req: NextRequest): string {
  const patUid = req.cookies.get("pat_uid")?.value;
  if (patUid) return `cookie:${patUid}`;
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0";
  return `ip:${ip}`;
}

function secondsUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

function forwardHeaders(req: NextRequest): Headers {
  const h = new Headers();
  const blocked = ["host", "connection", "content-length"];
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (blocked.includes(lk) || lk.startsWith("x-internal-")) continue;
    h.set(k, v);
  }
  return h;
}

async function passthrough(
  req: NextRequest,
  url: string,
): Promise<NextResponse> {
  // Plain forward, preserves SSE streaming. No HMAC, no budget logic.
  const init: RequestInit & { duplex?: string } = {
    method: req.method,
    headers: forwardHeaders(req),
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    init.duplex = "half";
  }
  const upstream = await fetch(url, init);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: new Headers(upstream.headers),
  });
}

async function runStart(
  req: NextRequest,
  url: string,
): Promise<NextResponse> {
  // 1) HMAC verify
  const patUid = req.cookies.get("pat_uid")?.value ?? "";
  const sessionToken = req.headers.get("x-pat-session") ?? "";
  if (!verifyHmac(patUid, sessionToken)) {
    return NextResponse.json({ error: "session_invalid" }, { status: 401 });
  }

  const subject = subjectKeyFor(req);
  let warnHeader: string | null = null;

  // 2) Global month kill-switch
  try {
    const gRes = await fetch(`${BACKEND}/budget/check?subject=__global_month`);
    const g = await gRes.json();
    if (!g.allowed) {
      return NextResponse.json(
        { error: "service_paused_global_budget", reset_at: g.reset_at },
        {
          status: 503,
          headers: { "Retry-After": secondsUntil(g.reset_at).toString() },
        },
      );
    }
  } catch (e) {
    // If the budget endpoint is unreachable, fail open in dev but log loud.
    console.error("budget /check global_month failed:", e);
  }

  // 3) Per-subject daily gate
  try {
    const dRes = await fetch(
      `${BACKEND}/budget/check?subject=${encodeURIComponent(subject)}`,
    );
    const d = await dRes.json();
    if (!d.allowed) {
      return NextResponse.json(
        {
          error: "daily_budget_exceeded",
          used_rub: d.used_rub,
          limit_rub: d.limit_rub,
          reset_at: d.reset_at,
        },
        {
          status: 429,
          headers: { "Retry-After": secondsUntil(d.reset_at).toString() },
        },
      );
    }
    if (d.warn) {
      warnHeader = `used=${d.used_rub};limit=${d.limit_rub}`;
    }
  } catch (e) {
    console.error("budget /check subject failed:", e);
  }

  // 4) Inject subject_key into config.configurable
  const bodyText = await req.text();
  let bodyJson: Record<string, unknown> = {};
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    /* leave empty — upstream will reject malformed bodies on its own */
  }
  const config = ((bodyJson.config as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const configurable = ((config.configurable as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  configurable.subject_key = subject;
  config.configurable = configurable;
  bodyJson.config = config;

  const upstream = await fetch(url, {
    method: req.method,
    headers: forwardHeaders(req),
    body: JSON.stringify(bodyJson),
    // @ts-expect-error duplex is required by undici for streaming bodies
    duplex: "half",
  });
  const headers = new Headers(upstream.headers);
  if (warnHeader) headers.set("x-budget-warning", warnHeader);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ _path: string[] }> },
) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204 });
  }

  const { _path } = await params;
  const pathStr = _path.join("/");
  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

  // 1) Public paths — forwarded without HMAC verify. MCP is the product
  //    feature; the others are diagnostic / public corpus index. See
  //    docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md
  //    section 2.
  if (PUBLIC_RE.test(pathStr)) {
    return passthrough(req, url);
  }

  // 2) Run-start paths — full HMAC verify + budget guard + subject inject.
  //    Frontend uses stateless `runs/stream`. The threads/{id}/runs/stream
  //    variant is pre-allowed for future stateful threading.
  if (
    RUN_START_RE.test(pathStr) &&
    (req.method === "POST" || req.method === "PUT")
  ) {
    return runStart(req, url);
  }

  // 3) Whitelist closes by default — everything else is 404.
  return new NextResponse(null, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
