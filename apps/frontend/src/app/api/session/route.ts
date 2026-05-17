/**
 * GET /api/session — refresh the daily HMAC session token.
 *
 * Called by the client after a midnight-rollover 401 to get a fresh token
 * without a full page reload. Mirrors the HMAC formula in `layout.tsx` and
 * in `apps/backend/src/backend/budget/session.py:sign`. Node runtime so we
 * can use `node:crypto.createHmac`.
 *
 * Returns 400 when the cookie is missing (treat as a normal-user state — the
 * middleware will issue one on the next regular GET). Returns 500 when the
 * server secret isn't configured.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = process.env.PAT_SESSION_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const patUid = req.cookies.get("pat_uid")?.value;
  if (!patUid) {
    return NextResponse.json({ error: "no_cookie" }, { status: 400 });
  }
  const date = new Date().toISOString().slice(0, 10);
  const token = crypto
    .createHmac("sha256", secret)
    .update(`cookie:${patUid}:${date}`)
    .digest("base64url");
  return NextResponse.json({
    token,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}
