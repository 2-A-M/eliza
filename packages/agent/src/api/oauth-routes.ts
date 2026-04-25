/**
 * Local OAuth routes for Milady connectors that the n8n credential provider
 * needs but that don't fit the bot-token paste flow Discord/Telegram use.
 *
 * First cut targets Gmail (Google OAuth 2 with PKCE + offline access for the
 * refresh token). Slack OAuth v2 follows the same pattern and can be added
 * by registering another platform here.
 *
 * Distribution model: bring-your-own client.
 *   - User registers their own OAuth client in Google Cloud / Slack admin.
 *   - Pastes `clientId` + `clientSecret` into Settings → Connectors → Gmail.
 *   - Clicks "Connect" — opens Google's consent screen in a new window.
 *   - Window redirects back to `GET /api/oauth/gmail/callback?code=&state=`.
 *   - Server exchanges the code for tokens, persists them into
 *     `connectors.gmail.{accessToken, refreshToken, expiresAt, scope, email}`
 *     via `saveElizaConfig`, and returns an HTML page that closes itself.
 *   - The next time the n8n credential provider's `resolve()` runs for
 *     `gmailOAuth2`, it sees the populated tokens and returns
 *     `{status:"credential_data", data:{accessToken, ...}}` instead of
 *     `{status:"needs_auth"}`.
 *
 * State management:
 *   - PKCE verifier + state nonce live in an in-memory Map keyed by state.
 *   - Entries expire after 10 minutes (same as Google's authorization-code
 *     window). A simple sweep on every initiate keeps the map bounded.
 *   - The map is process-local; restarting Milady mid-flow forces a fresh
 *     consent. Acceptable for single-user local use.
 */

import { createHash, randomBytes } from "node:crypto";
import type http from "node:http";
import type { ElizaConfig } from "../config/config.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface OAuthRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  state: { config: ElizaConfig };
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  error: (res: http.ServerResponse, message: string, status?: number) => void;
  saveElizaConfig: (config: ElizaConfig) => void;
}

interface PendingOAuth {
  platform: "gmail";
  codeVerifier: string;
  createdAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

// ── In-memory state map ──────────────────────────────────────────────────

const pending = new Map<string, PendingOAuth>();
const STATE_TTL_MS = 10 * 60 * 1000;

function sweepExpired(now: number): void {
  for (const [stateKey, entry] of pending.entries()) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pending.delete(stateKey);
    }
  }
}

// ── PKCE helpers ─────────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

function makeCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

function makeState(): string {
  return base64UrlEncode(randomBytes(16));
}

// ── Platform configs ─────────────────────────────────────────────────────

const GMAIL_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
/**
 * Default scopes cover the n8n Gmail node's read-and-summarize use case
 * (`gmail.readonly`) plus send (`gmail.send`) so workflows can compose +
 * dispatch summaries. Users can override via the Settings panel later.
 */
const GMAIL_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

function readGmailClientCredentials(
  config: ElizaConfig,
): { clientId: string; clientSecret: string } | null {
  const connectors = config.connectors as Record<string, unknown> | undefined;
  const gmail = connectors?.gmail as Record<string, unknown> | undefined;
  const clientId =
    typeof gmail?.clientId === "string" ? gmail.clientId.trim() : "";
  const clientSecret =
    typeof gmail?.clientSecret === "string" ? gmail.clientSecret.trim() : "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getRedirectUri(req: http.IncomingMessage, platform: string): string {
  // Trust the loopback bind. Milady's API server runs on the loopback only
  // in dev (:31337) and prod (:2138) per CLAUDE.md, so origin is always
  // safe to derive from the host header.
  const host = req.headers.host ?? "localhost:31337";
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${proto}://${host}/api/oauth/${platform}/callback`;
}

// ── HTML helpers for the callback close page ─────────────────────────────

function callbackHtml(
  status: "ok" | "error",
  message: string,
  platform: string,
): string {
  const safeMessage = String(message).replace(/[<>&"]/g, "");
  const safePlatform = String(platform).replace(/[<>&"]/g, "");
  // Minimal page: posts result back to the opener and closes. Survives
  // gracefully if there's no opener (user opened the URL directly).
  return `<!doctype html><html><head><meta charset="utf-8"><title>Milady ${safePlatform} OAuth</title>
<style>body{font:14px system-ui;margin:40px;color:#111}.ok{color:#0a0}.err{color:#a00}</style>
</head><body>
<h2 class="${status === "ok" ? "ok" : "err"}">${status === "ok" ? "Connected" : "Connection failed"}</h2>
<p>${safeMessage}</p>
<p>You can close this window.</p>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({ type: "milady:oauth:complete", platform: ${JSON.stringify(safePlatform)}, status: ${JSON.stringify(status)} }, "*");
  }
} catch (e) { /* ignore */ }
setTimeout(function(){ try { window.close(); } catch (e) {} }, 1500);
</script>
</body></html>`;
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  body: string,
): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

// ── Gmail OAuth flow ─────────────────────────────────────────────────────

async function exchangeGmailCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    code_verifier: args.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
  });
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

async function fetchGmailEmail(
  accessToken: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(GMAIL_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

async function handleGmailInitiate(ctx: OAuthRouteContext): Promise<void> {
  const creds = readGmailClientCredentials(ctx.state.config);
  if (!creds) {
    ctx.error(
      ctx.res,
      "Gmail OAuth client credentials missing. Set connectors.gmail.clientId and connectors.gmail.clientSecret first (Settings → Connectors → Gmail).",
      400,
    );
    return;
  }

  sweepExpired(Date.now());

  const stateKey = makeState();
  const codeVerifier = makeCodeVerifier();
  const codeChallenge = makeCodeChallenge(codeVerifier);
  pending.set(stateKey, {
    platform: "gmail",
    codeVerifier,
    createdAt: Date.now(),
  });

  const redirectUri = getRedirectUri(ctx.req, "gmail");
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_DEFAULT_SCOPES.join(" "),
    state: stateKey,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
  });
  const authorizeUrl = `${GMAIL_AUTHORIZE_URL}?${params.toString()}`;
  ctx.json(ctx.res, { authorizeUrl, redirectUri }, 200);
}

async function handleGmailCallback(ctx: OAuthRouteContext): Promise<void> {
  const url = new URL(ctx.req.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code");
  const stateKey = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    sendHtml(ctx.res, 400, callbackHtml("error", errParam, "gmail"));
    return;
  }
  if (!code || !stateKey) {
    sendHtml(
      ctx.res,
      400,
      callbackHtml("error", "Missing code/state", "gmail"),
    );
    return;
  }

  const entry = pending.get(stateKey);
  pending.delete(stateKey);
  if (!entry || entry.platform !== "gmail") {
    sendHtml(
      ctx.res,
      400,
      callbackHtml("error", "Unknown or expired state", "gmail"),
    );
    return;
  }

  const creds = readGmailClientCredentials(ctx.state.config);
  if (!creds) {
    sendHtml(
      ctx.res,
      400,
      callbackHtml("error", "Gmail client credentials missing", "gmail"),
    );
    return;
  }

  let tokens: GoogleTokenResponse;
  try {
    tokens = await exchangeGmailCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: getRedirectUri(ctx.req, "gmail"),
      code,
      codeVerifier: entry.codeVerifier,
    });
  } catch (err) {
    sendHtml(
      ctx.res,
      500,
      callbackHtml(
        "error",
        err instanceof Error ? err.message : String(err),
        "gmail",
      ),
    );
    return;
  }

  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;
  if (!accessToken || !refreshToken) {
    sendHtml(
      ctx.res,
      500,
      callbackHtml(
        "error",
        "Token response missing access_token or refresh_token. Make sure access_type=offline and prompt=consent are set; you may need to revoke prior consent at https://myaccount.google.com/permissions.",
        "gmail",
      ),
    );
    return;
  }
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 0;
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined;

  const email = await fetchGmailEmail(accessToken);

  const config = ctx.state.config as ElizaConfig & {
    connectors?: Record<string, unknown>;
  };
  const nextConnectors = {
    ...((config.connectors as Record<string, unknown> | undefined) ?? {}),
  };
  const existingGmail =
    (nextConnectors.gmail as Record<string, unknown> | undefined) ?? {};
  nextConnectors.gmail = {
    ...existingGmail,
    enabled: true,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken,
    refreshToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(email ? { email } : {}),
  };
  // ElizaConfig is intentionally treated as Record<string, unknown> for
  // mutation here — the schema's `.passthrough()` accepts the gmail block.
  (config as Record<string, unknown>).connectors = nextConnectors;
  ctx.saveElizaConfig(config);

  sendHtml(
    ctx.res,
    200,
    callbackHtml(
      "ok",
      email ? `Connected as ${email}` : "Connected",
      "gmail",
    ),
  );
}

// ── Public entry point ───────────────────────────────────────────────────

const ROUTE_RE = /^\/api\/oauth\/([a-z0-9_-]+)\/(initiate|callback)$/i;

/**
 * Returns true if the route was handled (response sent), false otherwise.
 * Wire-up sits in `api/server.ts` next to `handleConnectorRoutes`.
 */
export async function handleOAuthRoutes(
  ctx: OAuthRouteContext,
): Promise<boolean> {
  const match = ROUTE_RE.exec(ctx.pathname);
  if (!match) return false;
  const [, platform, action] = match;

  if (platform === "gmail") {
    if (action === "initiate" && ctx.method === "POST") {
      await handleGmailInitiate(ctx);
      return true;
    }
    if (action === "callback" && ctx.method === "GET") {
      await handleGmailCallback(ctx);
      return true;
    }
  }

  // Slack OAuth wiring goes here next; today the credential provider returns
  // needs_auth for Slack types, prompting the same Settings flow once it's built.
  ctx.error(
    ctx.res,
    `OAuth platform "${platform}" not yet supported`,
    404,
  );
  return true;
}

/** Test/debug helper. */
export function _resetPendingOAuthState(): void {
  pending.clear();
}
