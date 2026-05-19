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

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

// Group by IPv4 /24 or IPv6 /48 — broad enough to follow a single user across
// short ISP IP shuffles, narrow enough that fingerprint collisions stay
// roughly "device class within a home/office network".
function ipPrefix(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return ip.split(".").slice(0, 3).join(".");
}

function fpHash(req: NextRequest, ip: string): string {
  const ua = req.headers.get("user-agent") ?? "";
  const lang = req.headers.get("accept-language") ?? "";
  return crypto
    .createHash("sha256")
    .update(`${ua}|${lang}|${ipPrefix(ip)}`)
    .digest("base64url")
    .slice(0, 22);
}

// Returns the three independent budget buckets for a run-start request.
// `runStart` guarantees `patUid` is non-empty (HMAC verify happens first), so
// `cookie` is always populated here.
function subjectKeysFor(req: NextRequest, patUid: string): {
  cookie: string;
  ip: string;
  fp: string;
} {
  const ip = clientIp(req);
  return {
    cookie: `cookie:${patUid}`,
    ip: `ip:${ip}`,
    fp: `fp:${fpHash(req, ip)}`,
  };
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

type BudgetCheck = {
  allowed: boolean;
  used_rub: number;
  limit_rub: number;
  warn: boolean;
  reset_at: string;
};

async function fetchCheck(subject: string): Promise<BudgetCheck | null> {
  try {
    const r = await fetch(
      `${BACKEND}/budget/check?subject=${encodeURIComponent(subject)}`,
    );
    return (await r.json()) as BudgetCheck;
  } catch (e) {
    // Fail open if /budget/check is unreachable — match prior behavior.
    console.error(`budget /check ${subject} failed:`, e);
    return null;
  }
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

  const keys = subjectKeysFor(req, patUid);

  // 2) Run all four budget checks in parallel. global_month is a 503 service
  //    kill-switch; per-subject buckets each independently 429 if exhausted.
  //    AND-semantics: every per-subject bucket must allow the run.
  const [globalChk, cookieChk, ipChk, fpChk] = await Promise.all([
    fetchCheck("__global_month"),
    fetchCheck(keys.cookie),
    fetchCheck(keys.ip),
    fetchCheck(keys.fp),
  ]);

  if (globalChk && !globalChk.allowed) {
    return NextResponse.json(
      { error: "service_paused_global_budget", reset_at: globalChk.reset_at },
      {
        status: 503,
        headers: { "Retry-After": secondsUntil(globalChk.reset_at).toString() },
      },
    );
  }

  // Pick the first denial across the three per-subject buckets.
  const subjectChecks: Array<[string, BudgetCheck | null]> = [
    ["cookie", cookieChk],
    ["ip", ipChk],
    ["fp", fpChk],
  ];
  for (const [bucket, chk] of subjectChecks) {
    if (chk && !chk.allowed) {
      return NextResponse.json(
        {
          error: "daily_budget_exceeded",
          bucket,
          used_rub: chk.used_rub,
          limit_rub: chk.limit_rub,
          reset_at: chk.reset_at,
        },
        {
          status: 429,
          headers: { "Retry-After": secondsUntil(chk.reset_at).toString() },
        },
      );
    }
  }

  // Surface the cookie bucket's warn flag (the one users care about — "I'm
  // running out"). IP/fp warns would be misleading on shared networks.
  const warnHeader = cookieChk?.warn
    ? `used=${cookieChk.used_rub};limit=${cookieChk.limit_rub}`
    : null;

  // 3) Inject the three subject keys into config.configurable so the backend
  //    accounting node can UPSERT all of them.
  const bodyText = await req.text();
  let bodyJson: Record<string, unknown> = {};
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    /* leave empty — upstream will reject malformed bodies on its own */
  }
  const config = ((bodyJson.config as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const configurable = ((config.configurable as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  configurable.subject_keys = [keys.cookie, keys.ip, keys.fp];
  // Backwards-compat: old backend builds read singular `subject_key`. Drop
  // once every prod backend has the multi-bucket node.
  configurable.subject_key = keys.cookie;
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
