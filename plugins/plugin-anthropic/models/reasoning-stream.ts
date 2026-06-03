/**
 * Split an AI SDK `fullStream` into two string async-iterables: visible text
 * (`text-delta` parts) and model reasoning (`reasoning-delta` parts).
 *
 * A single background consumer reads `fullStream` once and routes each part to
 * the matching channel, so the two outputs MUST be drained concurrently (the
 * runtime does this). Other part types (tool calls, reasoning boundaries, …)
 * are ignored. Both AI SDK delta parts carry their payload on `.delta`.
 */
export interface FullStreamLikePart {
  readonly type: string;
  readonly delta?: string;
}

interface ChunkSink {
  push(chunk: string): void;
  close(error?: unknown): void;
  readonly iterable: AsyncIterable<string>;
}

/** A minimal single-producer / single-consumer async string channel. */
function createChunkSink(): ChunkSink {
  const buffer: string[] = [];
  let waiting: ((result: IteratorResult<string>) => void) | undefined;
  let closed = false;
  let failure: unknown;
  let hasFailure = false;

  return {
    push(chunk: string): void {
      if (closed) {
        return;
      }
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    },
    close(error?: unknown): void {
      if (closed) {
        return;
      }
      closed = true;
      if (error !== undefined) {
        failure = error;
        hasFailure = true;
      }
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve({ value: "", done: true });
      }
    },
    iterable: {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        while (true) {
          if (buffer.length > 0) {
            yield buffer.shift() as string;
            continue;
          }
          if (closed) {
            if (hasFailure) {
              throw failure;
            }
            return;
          }
          const result = await new Promise<IteratorResult<string>>((resolve) => {
            waiting = resolve;
          });
          if (result.done) {
            if (hasFailure) {
              throw failure;
            }
            return;
          }
          yield result.value;
        }
      },
    },
  };
}

export function splitReasoningFromFullStream(fullStream: AsyncIterable<FullStreamLikePart>): {
  textStream: AsyncIterable<string>;
  reasoningStream: AsyncIterable<string>;
} {
  const text = createChunkSink();
  const reasoning = createChunkSink();

  void (async () => {
    try {
      for await (const part of fullStream) {
        if (part.type === "text-delta") {
          if (part.delta) {
            text.push(part.delta);
          }
        } else if (part.type === "reasoning-delta") {
          if (part.delta) {
            reasoning.push(part.delta);
          }
        }
      }
      text.close();
      reasoning.close();
    } catch (error) {
      text.close(error);
      reasoning.close(error);
    }
  })();

  return { textStream: text.iterable, reasoningStream: reasoning.iterable };
}
