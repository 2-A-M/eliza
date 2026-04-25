import type { AgentRuntime } from "@elizaos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ConnectorConfigLike,
  N8N_CREDENTIAL_PROVIDER_SERVICE_TYPE,
  startMiladyN8nCredentialProvider,
} from "./n8n-credential-provider";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeRuntime(): AgentRuntime {
  const services = new Map<string, unknown[]>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    services,
    logger,
  } as unknown as AgentRuntime;
}

function makeConfig(overrides: ConnectorConfigLike = {}): ConnectorConfigLike {
  return {
    connectors: {
      ...(overrides.connectors ?? {}),
    },
  };
}

describe("startMiladyN8nCredentialProvider", () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = makeRuntime();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers itself under n8n_credential_provider on construction", () => {
    const config = makeConfig({ connectors: { discord: { token: "abc" } } });
    startMiladyN8nCredentialProvider(runtime, { getConfig: () => config });
    const instances = runtime.services.get(
      N8N_CREDENTIAL_PROVIDER_SERVICE_TYPE as never,
    );
    expect(instances).toBeDefined();
    expect(instances?.length).toBe(1);
    expect(typeof (instances?.[0] as { resolve: unknown }).resolve).toBe(
      "function",
    );
  });

  it("returns credential_data with botToken for discordApi when token present", async () => {
    const config = makeConfig({
      connectors: { discord: { enabled: true, token: "discord-bot-token" } },
    });
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => config,
    });
    const result = await handle.service.resolve(USER_ID, "discordApi");
    expect(result).toEqual({
      status: "credential_data",
      data: { botToken: "discord-bot-token" },
    });
  });

  it("returns needs_auth for discordApi when token missing", async () => {
    const config = makeConfig({ connectors: {} });
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => config,
    });
    const result = await handle.service.resolve(USER_ID, "discordApi");
    expect(result).toEqual({
      status: "needs_auth",
      authUrl: "milady://settings/connectors/discord",
    });
  });

  it("returns needs_auth for discordWebhookApi even with bot token (different shape)", async () => {
    const config = makeConfig({
      connectors: { discord: { token: "discord-bot-token" } },
    });
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => config,
    });
    const result = await handle.service.resolve(USER_ID, "discordWebhookApi");
    expect(result).toEqual({
      status: "needs_auth",
      authUrl: "milady://settings/connectors/discord",
    });
  });

  it("returns credential_data with accessToken+baseUrl for telegramApi when botToken present", async () => {
    const config = makeConfig({
      connectors: { telegram: { enabled: true, botToken: "tg-bot-token" } },
    });
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => config,
    });
    const result = await handle.service.resolve(USER_ID, "telegramApi");
    expect(result).toEqual({
      status: "credential_data",
      data: { accessToken: "tg-bot-token", baseUrl: "https://api.telegram.org" },
    });
  });

  it("returns needs_auth with deep-link for gmailOAuth2 (deferred to P2 OAuth flow)", async () => {
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => makeConfig(),
    });
    const result = await handle.service.resolve(USER_ID, "gmailOAuth2");
    expect(result).toEqual({
      status: "needs_auth",
      authUrl: "milady://settings/connectors/gmail",
    });
  });

  it("returns needs_auth with deep-link for slackOAuth2Api", async () => {
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => makeConfig(),
    });
    const result = await handle.service.resolve(USER_ID, "slackOAuth2Api");
    expect(result).toEqual({
      status: "needs_auth",
      authUrl: "milady://settings/connectors/slack",
    });
  });

  it("returns null for unmapped credential types (plugin falls back to manual)", async () => {
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => makeConfig(),
    });
    const result = await handle.service.resolve(USER_ID, "stripeApi");
    expect(result).toBeNull();
  });

  it("re-reads config on each resolve so a token added mid-session is picked up", async () => {
    let token: string | undefined;
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => ({ connectors: { discord: { token } } }),
    });

    const before = await handle.service.resolve(USER_ID, "discordApi");
    expect(before).toEqual({
      status: "needs_auth",
      authUrl: "milady://settings/connectors/discord",
    });

    token = "fresh-token";
    const after = await handle.service.resolve(USER_ID, "discordApi");
    expect(after).toEqual({
      status: "credential_data",
      data: { botToken: "fresh-token" },
    });
  });

  it("checkCredentialTypes partitions supported vs unsupported", () => {
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => makeConfig(),
    });
    const result = handle.service.checkCredentialTypes([
      "discordApi",
      "telegramApi",
      "gmailOAuth2",
      "stripeApi",
      "openAiApi",
    ]);
    expect(result.supported.sort()).toEqual(
      ["discordApi", "telegramApi", "gmailOAuth2"].sort(),
    );
    expect(result.unsupported.sort()).toEqual(["openAiApi", "stripeApi"]);
  });

  it("stop() removes the service from runtime.services", () => {
    const handle = startMiladyN8nCredentialProvider(runtime, {
      getConfig: () => makeConfig(),
    });
    expect(
      runtime.services.get(N8N_CREDENTIAL_PROVIDER_SERVICE_TYPE as never),
    ).toBeDefined();
    handle.stop();
    expect(
      runtime.services.get(N8N_CREDENTIAL_PROVIDER_SERVICE_TYPE as never),
    ).toBeUndefined();
  });
});
