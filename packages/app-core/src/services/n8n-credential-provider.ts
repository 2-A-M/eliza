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
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      scope?: string;
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
const OAUTH_DEFERRED_TYPES = new Set([
  "gmailOAuth2",
  "gmailOAuth2Api",
  "googleOAuth2Api",
  "googleSheetsOAuth2Api",
  "googleCalendarOAuth2Api",
  "googleDriveOAuth2Api",
  "slackApi",
  "slackOAuth2Api",
]);

const OAUTH_DEEP_LINK_PLATFORM: Record<string, string> = {
  gmailOAuth2: "gmail",
  gmailOAuth2Api: "gmail",
  googleOAuth2Api: "gmail",
  googleSheetsOAuth2Api: "gmail",
  googleCalendarOAuth2Api: "gmail",
  googleDriveOAuth2Api: "gmail",
  slackApi: "slack",
  slackOAuth2Api: "slack",
};

export const MILADY_SUPPORTED_CRED_TYPES: ReadonlySet<string> = new Set([
  ...DISCORD_TYPES,
  ...TELEGRAM_TYPES,
  ...OAUTH_DEFERRED_TYPES,
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
  const { getConfig } = options;

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
