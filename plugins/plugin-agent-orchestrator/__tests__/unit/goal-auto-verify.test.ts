/**
 * Automated goal-verification loop ({@link OrchestratorTaskService.maybeAutoVerify}).
 *
 * On `task_complete` for a task opted into `metadata.autoVerify`, the service
 * asks the LLM goal verifier for a verdict and forwards it to `validateTask`.
 * A pass promotes the task to `done`; a fail re-prompts the live session with
 * the missing criteria, and the per-task iteration cap parks the task at
 * `waiting_on_user` instead of looping forever. A task NOT opted in must never
 * trigger a model call.
 */

import type { IAgentRuntime } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestratorTaskService } from "../../src/services/orchestrator-task-service.js";
import { OrchestratorTaskStore } from "../../src/services/orchestrator-task-store.js";

class FakeAcp {
  private handler:
    | ((sessionId: string, event: string, data: unknown) => void)
    | null = null;
  private counter = 0;
  readonly sent: { sessionId: string; message: string }[] = [];

  onSessionEvent(
    cb: (sessionId: string, event: string, data: unknown) => void,
  ): () => void {
    this.handler = cb;
    return () => {
      this.handler = null;
    };
  }
  emit(sessionId: string, event: string, data: unknown = {}): void {
    this.handler?.(sessionId, event, data);
  }
  spawnSession(opts: Record<string, unknown>): Promise<{
    sessionId: string;
    agentType: string;
    workdir: string;
    status: string;
  }> {
    this.counter += 1;
    return Promise.resolve({
      sessionId: `session-${this.counter}`,
      agentType: (opts.agentType as string | undefined) ?? "codex",
      workdir: "/repo",
      status: "ready",
    });
  }
  sendToSession(sessionId: string, message: string): Promise<void> {
    this.sent.push({ sessionId, message });
    return Promise.resolve();
  }
  stopSession(): Promise<void> {
    return Promise.resolve();
  }
}

function runtime(
  acp: FakeAcp,
  useModel: ReturnType<typeof vi.fn>,
): IAgentRuntime {
  return {
    getService: () => acp,
    useModel,
    getSetting: () => undefined,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

async function setup(
  modelResponse: string | (() => string),
  taskMeta: Record<string, unknown>,
) {
  const acp = new FakeAcp();
  const useModel = vi.fn(async () =>
    typeof modelResponse === "function" ? modelResponse() : modelResponse,
  );
  const service = new OrchestratorTaskService(runtime(acp, useModel), {
    store: new OrchestratorTaskStore({ backend: "memory" }),
  });
  await service.start();
  const task = await service.createTask({
    title: "Hello world",
    goal: "Write a hello world script",
    acceptanceCriteria: ["file exists", "prints Hello"],
    metadata: taskMeta,
  });
  const detail = await service.spawnAgentForTask(task.id);
  const sessionId = detail?.sessions[0]?.sessionId as string;
  return { service, acp, useModel, taskId: task.id, sessionId };
}

describe("auto-verify loop", () => {
  it("promotes the task to done when the verifier passes", async () => {
    const { service, acp, useModel, taskId, sessionId } = await setup(
      JSON.stringify({ passed: true, summary: "all good", missing: [] }),
      { autoVerify: true },
    );
    acp.emit(sessionId, "task_complete", { response: "done" });
    await flush();
    await flush();
    expect(useModel).toHaveBeenCalledTimes(1);
    const task = await service.getTask(taskId);
    expect(task?.status).toBe("done");
  });

  it("re-prompts the live session when the verifier fails", async () => {
    const { service, acp, taskId, sessionId } = await setup(
      JSON.stringify({
        passed: false,
        summary: "missing prints",
        missing: ["prints Hello"],
      }),
      { autoVerify: true },
    );
    acp.emit(sessionId, "task_complete", { response: "partial" });
    await flush();
    await flush();
    expect(acp.sent.length).toBe(1);
    expect(acp.sent[0]?.message).toContain("prints Hello");
    const task = await service.getTask(taskId);
    // Back to active (validateTask fail path) — not done.
    expect(task?.status).not.toBe("done");
  });

  it("does not call the model for a task that did not opt in", async () => {
    const { acp, useModel, sessionId } = await setup(
      JSON.stringify({ passed: true, summary: "x", missing: [] }),
      {},
    );
    acp.emit(sessionId, "task_complete", { response: "done" });
    await flush();
    await flush();
    expect(useModel).not.toHaveBeenCalled();
  });
});
