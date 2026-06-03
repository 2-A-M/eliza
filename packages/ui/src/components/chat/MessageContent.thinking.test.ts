import { describe, expect, it } from "vitest";
import { extractThinking, normalizeDisplayText } from "./MessageContent";

describe("extractThinking", () => {
  it("pulls reasoning out of a closed <think> block", () => {
    const { content, streaming } = extractThinking(
      "<think>step one\nstep two</think>Here is the answer.",
    );
    expect(content).toBe("step one\nstep two");
    expect(streaming).toBe(false);
  });

  it("treats an unclosed <think> block as still streaming", () => {
    const { content, streaming } = extractThinking("<think>partial reasoning");
    expect(content).toBe("partial reasoning");
    expect(streaming).toBe(true);
  });

  it("handles <reasoning> as well as <think>", () => {
    const { content } = extractThinking("<reasoning>why</reasoning>answer");
    expect(content).toBe("why");
  });

  it("joins multiple reasoning blocks", () => {
    const { content } = extractThinking(
      "<think>a</think>mid<think>b</think>end",
    );
    expect(content).toBe("a\n\nb");
  });

  it("returns empty for text with no reasoning", () => {
    const { content, streaming } = extractThinking("just an answer");
    expect(content).toBe("");
    expect(streaming).toBe(false);
  });
});

describe("normalizeDisplayText with reasoning", () => {
  it("removes <think> blocks from the user-facing answer", () => {
    expect(normalizeDisplayText("<think>secret</think>Hello, World!")).toBe(
      "Hello, World!",
    );
  });

  it("still strips tool_calls scaffolding", () => {
    expect(normalizeDisplayText("<tool_calls>{...}</tool_calls>visible")).toBe(
      "visible",
    );
  });

  it("does not leak a mid-stream <thi fragment", () => {
    expect(normalizeDisplayText("answer so far<thi")).toBe("answer so far");
  });
});
