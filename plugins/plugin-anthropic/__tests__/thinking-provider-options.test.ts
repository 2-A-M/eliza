import { describe, expect, it } from "vitest";
import { resolveThinkingProviderOptions, supportsExtendedThinking } from "../models/thinking";

describe("supportsExtendedThinking", () => {
  it("accepts Opus 4.x, Sonnet 4.x, and Sonnet 3.7", () => {
    for (const m of [
      "claude-opus-4-20250514",
      "claude-opus-4-1",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5",
      "claude-3-7-sonnet-20250219",
    ]) {
      expect(supportsExtendedThinking(m)).toBe(true);
    }
  });

  it("rejects models without extended thinking", () => {
    for (const m of [
      "claude-3-5-haiku-20241022",
      "claude-3-5-sonnet-20241022",
      "claude-haiku-4-5",
    ]) {
      expect(supportsExtendedThinking(m)).toBe(false);
    }
  });
});

describe("resolveThinkingProviderOptions", () => {
  const thinking = { type: "enabled", budgetTokens: 4096 } as const;

  it("keeps caller-supplied thinking on a capable model when no env budget", () => {
    const out = resolveThinkingProviderOptions(
      { anthropic: { thinking } },
      "claude-opus-4-20250514",
      0
    );
    expect(out.anthropic?.thinking).toEqual(thinking);
  });

  it("strips caller-supplied thinking on a non-capable model, keeping the rest", () => {
    const out = resolveThinkingProviderOptions(
      { anthropic: { thinking, cacheControl: { type: "ephemeral" } } },
      "claude-3-5-haiku-20241022",
      0
    );
    expect(out.anthropic?.thinking).toBeUndefined();
    expect(out.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("applies the env budget (overriding the caller) on a capable model", () => {
    const out = resolveThinkingProviderOptions(
      { anthropic: { thinking } },
      "claude-sonnet-4-20250514",
      8192
    );
    expect(out.anthropic?.thinking).toEqual({
      type: "enabled",
      budgetTokens: 8192,
    });
  });

  it("never sets thinking when there is no budget and no caller thinking", () => {
    const out = resolveThinkingProviderOptions(
      { anthropic: { cacheControl: { type: "ephemeral" } } },
      "claude-opus-4-20250514",
      0
    );
    expect(out.anthropic?.thinking).toBeUndefined();
  });
});
