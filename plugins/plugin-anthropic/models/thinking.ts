import type { ModelName } from "../types";
import type { ProviderOptions } from "./text";

/**
 * Whether a model supports Anthropic extended thinking. Thinking config sent to
 * models that don't support it is rejected by the API (400), so any budget —
 * whether from env or supplied by the caller — must be gated by this. Covers
 * Claude Opus 4.x, Sonnet 4.x, and Sonnet 3.7.
 */
export function supportsExtendedThinking(modelName: ModelName): boolean {
  const m = modelName.toLowerCase();
  return m.includes("opus-4") || m.includes("sonnet-4") || m.includes("3-7-sonnet");
}

/** Return a copy of `options` with any `anthropic.thinking` removed. */
function stripAnthropicThinking(options: ProviderOptions): ProviderOptions {
  const { anthropic } = options;
  if (!anthropic || anthropic.thinking === undefined) {
    return options;
  }
  const { thinking: _thinking, ...rest } = anthropic;
  return { ...options, anthropic: rest };
}

/**
 * Resolve the final `anthropic.thinking` provider option for a text call.
 *
 * Extended thinking is only valid on capable models (and only on non-forced
 * tool calls — Anthropic 400s otherwise). The env budget
 * (`ANTHROPIC_COT_BUDGET_*`) takes precedence when set; otherwise a
 * caller-supplied `anthropic.thinking` (e.g. the deliberate-reply pass) flows
 * through unchanged. Thinking is stripped entirely for models that can't think.
 */
export function resolveThinkingProviderOptions(
  baseProviderOptions: ProviderOptions,
  modelName: ModelName,
  cotBudget: number
): ProviderOptions {
  if (!supportsExtendedThinking(modelName)) {
    return stripAnthropicThinking(baseProviderOptions);
  }
  if (cotBudget > 0) {
    return {
      ...baseProviderOptions,
      anthropic: {
        ...(baseProviderOptions.anthropic ?? {}),
        thinking: { type: "enabled", budgetTokens: cotBudget },
      },
    };
  }
  return baseProviderOptions;
}
