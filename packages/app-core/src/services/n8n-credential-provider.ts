/**
 * Milady n8n credential provider — registers as service type
 * `n8n_credential_provider` so `@elizaos/plugin-n8n-workflow` can resolve
 * credentials from `~/.milady/milady.json` connectors during workflow
 * generation + deployment.
 *
 * The plugin exposes a `CredentialProvider` extension point at
 * `node_modules/@elizaos/plugin-n8n-workflow/dist/types/index.d.ts`. Eliza
 * Cloud registers `N8nCredentialBridge` for cloud users; Milady local has no
 * equivalent until this service exists. Without it, generated workflows
 * deploy with no credentials attached and every node returns 401/403 at
 * execute time.
 *
 * Shape returned to the plugin:
 *
 *   resolve(userId, credType) →
 *     { status: "credential_data", data: <fields-for-type> }   // happy path
 *     { status: "needs_auth",     authUrl: <deep-link> }       // OAuth not yet wired
 *     null                                                     // unknown credType
 *
 * The plugin's workflow-deploy step receives `credential_data` and POSTs to
 * n8n's `/api/v1/credentials` itself; this service does NOT touch the n8n
 * REST API directly.
 *
 * First cut (per plan §P1):
 *   - `discordApi` / `discordBotApi` / `discordWebhookApi` → Discord bot token
 *     pulled from `connectors.discord.token`.
 *   - `telegramApi` → Telegram bot token pulled from `connectors.telegram.botToken`.
 *   - `gmailOAuth2` / `gmailOAuth2Api` / `slackApi` / `slackOAuth2Api` /
 *     `googleSheetsOAuth2Api` → returns `needs_auth` with a deep-link to the
 *     Settings panel where the user will eventually run the OAuth flow (P2).
 *   - Any other credType → `null`, the plugin falls back to "manual setup".
 */

import type { AgentRuntime, IAgentRuntime } from "@elizaos/core";

const SERVICE_TYPE = "n8n_credential_provider";

/** Subset of ElizaConfig the provider reads. */
export interface ConnectorConfigLike {
  connectors?: {
    discord?: { enabled?: boolean; token?: string };
    telegram?: { enabled?: boolean; botToken?: string };
    gmail?: {
      enabled?: boolean;
      clientId?: string;
      clientSecret?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      scope?: string;
      email?: string;
    };
    slack?: {
      enabled?: boolean;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}

export interface MiladyN8nCredentialProviderOptions {
  /**
   * Reads the most recent ElizaConfig. The provider re-reads on every
   * `resolve()` so the user toggling a connector does not require a runtime
   * restart for the next workflow deploy.
   */
  getConfig: () => ConnectorConfigLike;
  /**
   * Persists the config back to disk. Used to update Gmail tokens after a
   * refresh-token flow runs. If omitted, refreshed tokens are still
   * returned to the caller but won't survive a process restart.
   */
  saveConfig?: (config: ConnectorConfigLike) => void;
  /** Test injection seam — defaults to fetch. */
  fetchImpl?: typeof fetch;
  /** Test injection seam — defaults to Date.now. */
  now?: () => number;
}

type CredentialProviderResult =
  | { status: "credential_data"; data: Record<string, unknown> }
  | { status: "needs_auth"; authUrl: string }
  | null;

interface CheckCredentialTypesResult {
  supported: string[];
  unsupported: string[];
}

const DISCORD_TYPES = new Set([
  "discordApi",
  "discordBotApi",
  "discordWebhookApi",
]);
const TELEGRAM_TYPES = new Set(["telegramApi"]);
/**
 * Types not handled by a dedicated branch above but listed as "supported"
 * for the plugin's pre-flight check, so workflows that need them surface
 * `needs_auth` deep-links instead of "unsupported integration" errors.
 * Kept narrow on purpose — adding a type here is a promise the Settings UI
 * has a panel for it.
 */
const OAUTH_DEFERRED_TYPES = new Set<string>([]);

const OAUTH_DEEP_LINK_PLATFORM: Record<string, string> = {};

export const MILADY_SUPPORTED_CRED_TYPES: ReadonlySet<string> = new Set([
  ...DISCORD_TYPES,
  ...TELEGRAM_TYPES,
  // Gmail OAuth types
  "gmailOAuth2",
  "gmailOAuth2Api",
  "googleOAuth2Api",
  "googleSheetsOAuth2Api",
  "googleCalendarOAuth2Api",
  "googleDriveOAuth2Api",
  // Slack OAuth types
  "slackApi",
  "slackOAuth2Api",
]);

export interface MiladyN8nCredentialProviderHandle {
  /** Service-shaped object the plugin reads via `runtime.getService(...)`. */
  service: {
    resolve: (userId: string, credType: string) => Promise<CredentialProviderResult>;
    checkCredentialTypes: (credTypes: string[]) => CheckCredentialTypesResult;
    stop: () => Promise<void>;
    capabilityDescription: string;
  };
  /** Stop hook for hot-reload symmetry with the other Milady bridges. */
  stop: () => void;
}

const GMAIL_TYPES = new Set([
  "gmailOAuth2",
  "gmailOAuth2Api",
  "googleOAuth2Api",
  "googleSheetsOAuth2Api",
  "googleCalendarOAuth2Api",
  "googleDriveOAuth2Api",
]);

const SLACK_TYPES = new Set(["slackApi", "slackOAuth2Api"]);

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Refresh access tokens that expire within this window (ms). */
const REFRESH_LEAD_MS = 60 * 1000;

/**
 * Build the provider instance. Returns the service shape ready to be
 * registered into `runtime.services` under `SERVICE_TYPE`. The runtime's
 * `getService(SERVICE_TYPE)` returns the first instance, and the plugin's
 * `isCredentialProvider` type guard only checks `typeof .resolve === "function"`.
 */
export function startMiladyN8nCredentialProvider(
  runtime: AgentRuntime,
  options: MiladyN8nCredentialProviderOptions,
): MiladyN8nCredentialProviderHandle {
  const { getConfig, saveConfig } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  /**
   * Refresh a Gmail access token using the refresh token. Returns the new
   * `{accessToken, expiresAt}` and persists them back via `saveConfig` when
   * available so other consumers (and process restarts) see the fresh value.
   * Returns null on failure — the caller should fall back to needs_auth.
   */
  const refreshGmailAccessToken = async (
    config: ConnectorConfigLike,
  ): Promise<
    { accessToken: string; expiresAt: number; scope?: string } | null
  > => {
    const gmail = config.connectors?.gmail;
    if (
      !gmail?.refreshToken ||
      !gmail.clientId ||
      !gmail.clientSecret
    ) {
      return null;
    }
    try {
      const body = new URLSearchParams({
        client_id: gmail.clientId,
        client_secret: gmail.clientSecret,
        refresh_token: gmail.refreshToken,
        grant_type: "refresh_token",
      });
      const res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        runtime.logger.warn?.(
          {
            src: "n8n-credential-provider",
            status: res.status,
            body: text.slice(0, 200),
          },
          "Gmail refresh-token exchange failed",
        );
        return null;
      }
      const data = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!data.access_token) return null;
      const expiresIn =
        typeof data.expires_in === "number" ? data.expires_in : 3600;
      const expiresAt = now() + expiresIn * 1000;
      // Persist back so subsequent resolves and restarts see the refreshed
      // value. saveConfig is optional — without it the new token is only
      // returned to the current caller.
      if (saveConfig) {
        const nextConnectors = {
          ...((config.connectors ?? {}) as Record<string, unknown>),
        };
        nextConnectors.gmail = {
          ...gmail,
          accessToken: data.access_token,
          expiresAt,
          ...(data.scope ? { scope: data.scope } : {}),
        };
        saveConfig({
          ...(config as Record<string, unknown>),
          connectors: nextConnectors,
        } as ConnectorConfigLike);
      }
      return {
        accessToken: data.access_token,
        expiresAt,
        scope: data.scope,
      };
    } catch (err) {
      runtime.logger.warn?.(
        {
          src: "n8n-credential-provider",
          error: err instanceof Error ? err.message : String(err),
        },
        "Gmail refresh-token exchange threw",
      );
      return null;
    }
  };

  const resolve = async (
    _userId: string,
    credType: string,
  ): Promise<CredentialProviderResult> => {
    const config = getConfig();
    const connectors = config.connectors ?? {};

    if (DISCORD_TYPES.has(credType)) {
      const token = connectors.discord?.token?.trim();
      if (!token) {
        return {
          status: "needs_auth",
          authUrl: "milady://settings/connectors/discord",
        };
      }
      // n8n-nodes-base Discord credential schemas:
      // - discordApi:        { botToken }
      // - discordBotApi:     { botToken }
      // - discordWebhookApi: { webhookUri } (NOT a bot token — return needs_auth)
      if (credType === "discordWebhookApi") {
        return {
          status: "needs_auth",
          authUrl: "milady://settings/connectors/discord",
        };
      }
      return {
        status: "credential_data",
        data: { botToken: token },
      };
    }

    if (TELEGRAM_TYPES.has(credType)) {
      const botToken = connectors.telegram?.botToken?.trim();
      if (!botToken) {
        return {
          status: "needs_auth",
          authUrl: "milady://settings/connectors/telegram",
        };
      }
      // n8n's telegramApi credential expects `accessToken` (the bot token) and
      // optional `baseUrl`.
      return {
        status: "credential_data",
        data: { accessToken: botToken, baseUrl: "https://api.telegram.org" },
      };
    }

    if (GMAIL_TYPES.has(credType)) {
      const gmail = connectors.gmail;
      // No tokens at all — user hasn't run the OAuth flow yet.
      if (!gmail?.refreshToken || !gmail.clientId || !gmail.clientSecret) {
        return {
          status: "needs_auth",
          authUrl: "milady://settings/connectors/gmail",
        };
      }
      let accessToken = gmail.accessToken?.trim();
      const expiresAt =
        typeof gmail.expiresAt === "number" ? gmail.expiresAt : 0;
      const needsRefresh =
        !accessToken || expiresAt - now() < REFRESH_LEAD_MS;
      if (needsRefresh) {
        const refreshed = await refreshGmailAccessToken(config);
        if (!refreshed) {
          return {
            status: "needs_auth",
            authUrl: "milady://settings/connectors/gmail",
          };
        }
        accessToken = refreshed.accessToken;
      }
      // n8n's gmailOAuth2 credential expects `oauthTokenData.access_token` +
      // matching `clientId`/`clientSecret` so it can refresh on its side too.
      return {
        status: "credential_data",
        data: {
          clientId: gmail.clientId,
          clientSecret: gmail.clientSecret,
          oauthTokenData: {
            access_token: accessToken,
            refresh_token: gmail.refreshToken,
            scope: gmail.scope ?? "",
            token_type: "Bearer",
            expiry_date: expiresAt || 0,
          },
        },
      };
    }

    if (SLACK_TYPES.has(credType)) {
      // Slack OAuth not yet wired (P2 follow-up). For now defer to the
      // Settings panel when the user asks for it.
      const slack = connectors.slack;
      if (slack?.accessToken) {
        return {
          status: "credential_data",
          data: {
            accessToken: slack.accessToken,
          },
        };
      }
      return {
        status: "needs_auth",
        authUrl: "milady://settings/connectors/slack",
      };
    }

    if (OAUTH_DEFERRED_TYPES.has(credType)) {
      const platform = OAUTH_DEEP_LINK_PLATFORM[credType] ?? "settings";
      runtime.logger.info?.(
        {
          src: "n8n-credential-provider",
          credType,
          platform,
        },
        "credential provider: OAuth-deferred type, returning needs_auth",
      );
      return {
        status: "needs_auth",
        authUrl: `milady://settings/connectors/${platform}`,
      };
    }

    return null;
  };

  const checkCredentialTypes = (
    credTypes: string[],
  ): CheckCredentialTypesResult => {
    const supported: string[] = [];
    const unsupported: string[] = [];
    for (const credType of credTypes) {
      if (MILADY_SUPPORTED_CRED_TYPES.has(credType)) {
        supported.push(credType);
      } else {
        unsupported.push(credType);
      }
    }
    return { supported, unsupported };
  };

  const service = {
    resolve,
    checkCredentialTypes,
    stop: async () => {},
    capabilityDescription:
      "Resolves Milady connector credentials (Discord, Telegram) for n8n workflow deploys; OAuth types are deferred to Settings UI.",
  };

  // Register into the runtime services map. We deliberately do NOT use the
  // class-based `Service.start` registration path because the plugin's
  // discovery only requires a `.resolve` method (per `isCredentialProvider`),
  // and the function-shape mirrors `n8n-dispatch.ts` and `trigger-event-bridge.ts`.
  runtime.services.set(
    SERVICE_TYPE as never,
    [service as never],
  );

  return {
    service,
    stop: () => {
      try {
        runtime.services.delete(SERVICE_TYPE as never);
      } catch {
        // ignore — symmetric with other Milady bridge stop hooks
      }
    },
  };
}

/** Re-exported for tests + runtime helpers. */
export { SERVICE_TYPE as N8N_CREDENTIAL_PROVIDER_SERVICE_TYPE };

/** Test injection seam — type-only re-export. */
export type { IAgentRuntime };
