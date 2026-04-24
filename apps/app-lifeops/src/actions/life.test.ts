import type { IAgentRuntime, Memory, UUID } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lifeops/service.js", () => ({
  LifeOpsService: class LifeOpsService {},
  LifeOpsServiceError: class LifeOpsServiceError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

const ROOM_ID = "00000000-0000-4000-8000-000000000001" as UUID;

function buildRuntime(scope: string | undefined): {
  runtime: IAgentRuntime;
  getRoom: ReturnType<typeof vi.fn>;
} {
  // Room metadata is extracted via `extractConversationMetadataFromRoom`,
  // which reads the ConversationMetadata out of `room.metadata.webConversation`.
  // A missing webConversation block models "no scope set" (home chat).
  const metadata =
    scope === undefined ? undefined : { webConversation: { scope } };
  const getRoom = vi.fn(async (roomId: string) => ({
    id: roomId,
    metadata,
  }));
  const runtime = { getRoom } as unknown as IAgentRuntime;
  return { runtime, getRoom };
}

function buildMessage(text: string): Memory {
  return {
    id: "11111111-1111-4000-8000-000000000001" as UUID,
    roomId: ROOM_ID,
    entityId: "22222222-2222-4000-8000-000000000001" as UUID,
    agentId: "33333333-3333-4000-8000-000000000001" as UUID,
    content: { text, source: "test" },
  } as Memory;
}

async function runValidate(
  runtime: IAgentRuntime,
  message: Memory,
): Promise<boolean> {
  const { lifeAction } = await import("./life.js");
  const { validate } = lifeAction;
  if (!validate) {
    throw new Error("lifeAction.validate is required for this suite");
  }
  return validate(runtime, message);
}

describe("lifeAction.validate — scope gating", () => {
  const reminderPrompt = "set an alarm for 7am";

  it("rejects on page-automations scope (Session 8/10 reproduction)", async () => {
    const { runtime } = buildRuntime("page-automations");
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(false);
  });

  // `page-settings` is omitted deliberately — it is absent from the server-side
  // `VALID_SCOPES` allowlist in `@elizaos/agent/api/conversation-metadata`, so
  // the server sanitizes the scope out of room metadata before it reaches any
  // action `validate()`. LIFE cannot reject a scope the server has already
  // dropped; that inconsistency is a separate cleanup (parking-lot item in the
  // workflows-automations plan).
  it.each([
    "page-browser",
    "page-apps",
    "page-character",
    "page-phone",
    "page-wallet",
  ])("rejects on foreign page scope %s", async (scope) => {
    const { runtime } = buildRuntime(scope);
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(false);
  });

  it("accepts on page-lifeops scope (LifeOps surface)", async () => {
    const { runtime } = buildRuntime("page-lifeops");
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(true);
  });

  it("accepts when no scope metadata is set (home chat / direct app-lifeops room)", async () => {
    const { runtime } = buildRuntime(undefined);
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(true);
  });

  it("accepts on non-page scope (e.g. automation-draft)", async () => {
    const { runtime } = buildRuntime("automation-draft");
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(true);
  });

  it("rejects coding-task text even on page-lifeops scope (text filter short-circuits before scope check)", async () => {
    const { runtime, getRoom } = buildRuntime("page-lifeops");
    const message = buildMessage("build a dashboard component");
    const result = await runValidate(runtime, message);
    expect(result).toBe(false);
    expect(getRoom).not.toHaveBeenCalled();
  });

  // Regression test for Session 14 — proves the helper reads scope from the
  // full live room-metadata shape captured via in-process logging on
  // `bun run dev:desktop:watch` for a `page-automations` conversation:
  //   {
  //     ownership: { ownerId: "..." },
  //     webConversation: {
  //       scope: "page-automations",
  //       conversationId: "...",
  //       sourceConversationId: "...",
  //     },
  //   }
  // The simpler `{ webConversation: { scope } }` shape used elsewhere in this
  // file is a strict subset; this case pins the fully-populated invariant so
  // a future Room-metadata refactor that moves `scope` out of `webConversation`
  // surfaces here instead of silently re-enabling LIFE on foreign page scopes.
  it("rejects on page-automations with the fully-populated live room-metadata shape", async () => {
    const getRoom = vi.fn(async (roomId: string) => ({
      id: roomId,
      metadata: {
        ownership: {
          ownerId: "0afe069b-83d3-0ea3-aa07-a47dd72ade03" as UUID,
        },
        webConversation: {
          scope: "page-automations",
          conversationId: "895d1dcc-9b47-45e2-a2d4-073ae22266d5",
          sourceConversationId: "98665b9a-75f3-490f-89b7-34d24897ba6a",
        },
      },
    }));
    const runtime = { getRoom } as unknown as IAgentRuntime;
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(false);
    expect(getRoom).toHaveBeenCalledWith(ROOM_ID);
  });

  // The "ensureConnection reset" shape: room.metadata has only `ownership`
  // (no `webConversation` block at all). `buildConversationRoomMetadata`
  // writes the `webConversation` block on conversation create, but if a code
  // path ever lands a room without it — e.g. a future `ensureConnection`
  // refactor that clobbers metadata on message POST — the helper degrades to
  // "no scope visible" and LIFE stays eligible. This test pins that
  // degradation behavior so the next regressor has a clear failing assertion
  // rather than a silent behavior flip.
  it("returns no-scope (LIFE stays eligible) when room.metadata has only ownership", async () => {
    const getRoom = vi.fn(async (roomId: string) => ({
      id: roomId,
      metadata: {
        ownership: {
          ownerId: "0afe069b-83d3-0ea3-aa07-a47dd72ade03" as UUID,
        },
      },
    }));
    const runtime = { getRoom } as unknown as IAgentRuntime;
    const message = buildMessage(reminderPrompt);
    const result = await runValidate(runtime, message);
    expect(result).toBe(true);
  });
});
