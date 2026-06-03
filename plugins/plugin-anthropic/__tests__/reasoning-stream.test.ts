import { describe, expect, it } from "vitest";
import { type FullStreamLikePart, splitReasoningFromFullStream } from "../models/reasoning-stream";

async function* fromParts(parts: FullStreamLikePart[]): AsyncIterable<FullStreamLikePart> {
  for (const part of parts) {
    yield part;
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) {
    out += chunk;
  }
  return out;
}

describe("splitReasoningFromFullStream", () => {
  it("routes text-delta to text and reasoning-delta to reasoning", async () => {
    const { textStream, reasoningStream } = splitReasoningFromFullStream(
      fromParts([
        { type: "reasoning-start" },
        { type: "reasoning-delta", delta: "think " },
        { type: "reasoning-delta", delta: "hard" },
        { type: "reasoning-end" },
        { type: "text-delta", delta: "Hello" },
        { type: "text-delta", delta: " world" },
        { type: "finish" },
      ])
    );
    const [text, reasoning] = await Promise.all([collect(textStream), collect(reasoningStream)]);
    expect(text).toBe("Hello world");
    expect(reasoning).toBe("think hard");
  });

  it("yields an empty reasoning stream when there are no reasoning parts", async () => {
    const { textStream, reasoningStream } = splitReasoningFromFullStream(
      fromParts([{ type: "text-delta", delta: "just text" }, { type: "finish" }])
    );
    const [text, reasoning] = await Promise.all([collect(textStream), collect(reasoningStream)]);
    expect(text).toBe("just text");
    expect(reasoning).toBe("");
  });

  it("propagates a fullStream error to the text channel", async () => {
    async function* boom(): AsyncIterable<FullStreamLikePart> {
      yield { type: "text-delta", delta: "partial" };
      throw new Error("stream broke");
    }
    const { textStream } = splitReasoningFromFullStream(boom());
    await expect(collect(textStream)).rejects.toThrow("stream broke");
  });
});
