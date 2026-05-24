import type { IAgentRuntime, Memory, UUID } from "@elizaos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireTaskAgentAccess } from "../../src/services/task-policy.js";

const OWNER_ID = "411199782560727042";
const NON_OWNER_ID = "999999999999999999";

function runtime(settings: Record<string, string | undefined> = {}): IAgentRuntime {
  return {
    agentId: "agent-2pm" as UUID,
    getSetting: vi.fn((key: string) => settings[key]),
    getRoom: vi.fn(async () => null),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as IAgentRuntime;
}

function discordMessage(senderId: string, opts: { source?: string } = {}): Memory {
  return {
    id: "msg-1" as UUID,
    entityId: senderId as UUID,
    roomId: "room-1" as UUID,
    agentId: "agent-2pm" as UUID,
    content: {
      text: "build me a thing",
      source: opts.source ?? "discord",
      metadata: {
        rawMessage: { author: { id: senderId } },
      },
    },
    createdAt: Date.now(),
  } as Memory;
}

describe("requireTaskAgentAccess — DISCORD_OWNER_ID bypass", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.ELIZA_SKIP_LOCAL_PLUGIN_ROLES = "1";
    delete process.env.DISCORD_OWNER_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows the configured owner ID via Discord author metadata", async () => {
    const result = await requireTaskAgentAccess(
      runtime({ DISCORD_OWNER_ID: OWNER_ID }),
      discordMessage(OWNER_ID),
      "create",
    );

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.actualRole).toBe("OWNER");
      expect(result.connector).toBe("discord");
    }
  });

  it("denies a non-owner Discord sender when no role context is available", async () => {
    const result = await requireTaskAgentAccess(
      runtime({ DISCORD_OWNER_ID: OWNER_ID }),
      discordMessage(NON_OWNER_ID),
      "create",
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.connector).toBe("discord");
      expect(result.actualRole).toBe("GUEST");
    }
  });

  it("falls through to role check when DISCORD_OWNER_ID is unset", async () => {
    const result = await requireTaskAgentAccess(
      runtime({}),
      discordMessage(OWNER_ID),
      "create",
    );

    expect(result.allowed).toBe(false);
  });

  it("does not bypass for non-Discord connectors even when sender id matches owner", async () => {
    // Force telegram to require ADMIN so the GUEST default does not auto-allow.
    const policy = JSON.stringify({
      default: "GUEST",
      connectors: {
        telegram: { create: "ADMIN", interact: "ADMIN" },
      },
    });
    const result = await requireTaskAgentAccess(
      runtime({
        DISCORD_OWNER_ID: OWNER_ID,
        TASK_AGENT_ROLE_POLICY: policy,
      }),
      discordMessage(OWNER_ID, { source: "telegram" }),
      "create",
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.connector).toBe("telegram");
      expect(result.actualRole).toBe("GUEST");
    }
  });

  it("also reads DISCORD_OWNER_ID from process.env when runtime.getSetting is empty", async () => {
    process.env.DISCORD_OWNER_ID = OWNER_ID;
    const result = await requireTaskAgentAccess(
      runtime({}),
      discordMessage(OWNER_ID),
      "interact",
    );

    expect(result.allowed).toBe(true);
  });

  it("treats agent-self messages as OWNER (existing behavior preserved)", async () => {
    const msg = discordMessage(OWNER_ID);
    (msg as { entityId: UUID }).entityId = "agent-2pm" as UUID;

    const result = await requireTaskAgentAccess(
      runtime({ DISCORD_OWNER_ID: NON_OWNER_ID }),
      msg,
      "create",
    );

    expect(result.allowed).toBe(true);
  });
});
