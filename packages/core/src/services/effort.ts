import type { ChatEffort } from "../types/message-service";
import { ModelType, type ModelTypeName } from "../types/model";

/**
 * Concrete generation knobs derived from a chat "effort" level.
 *
 * Used by the message runtime to decide whether a high-effort turn runs a
 * separate thinking-enabled "deliberate reply" pass (a non-forced model call,
 * so Anthropic extended thinking is allowed — unlike the forced-tool Stage-1
 * envelope, which is incompatible with thinking), and with which model tier and
 * extended-thinking budget.
 */
export interface EffortKnobs {
	/**
	 * Model tier for the deliberate-reply pass. `undefined` means no deliberate
	 * pass runs — the reply comes straight from Stage-1, byte-identical to today.
	 */
	readonly modelType: ModelTypeName | undefined;
	/**
	 * Anthropic extended-thinking budget in tokens for the deliberate pass.
	 * `0` means thinking is off. Honored by plugin-anthropic only on
	 * extended-thinking-capable models (Sonnet/Opus 4.x); ignored elsewhere.
	 */
	readonly cotBudget: number;
	/** Whether a thinking-enabled deliberate-reply pass should run this turn. */
	readonly thinkingOn: boolean;
	/**
	 * Total output-token cap for the deliberate pass. Kept above `cotBudget` so
	 * the model has room for the reply after thinking, and under the Opus 4.x
	 * 32k hard output limit. `0` when no pass runs.
	 */
	readonly maxOutputTokens: number;
}

const NO_EFFORT: EffortKnobs = {
	modelType: undefined,
	cotBudget: 0,
	thinkingOn: false,
	maxOutputTokens: 0,
};

/**
 * Map a chat effort level to concrete generation knobs.
 *
 * `none`/`low` (and any unknown value) leave the turn byte-identical to today:
 * no deliberate pass, no thinking, default tier. `medium`/`high` opt into a
 * separate thinking-enabled `TEXT_LARGE` deliberate-reply pass with a larger
 * extended-thinking budget. Budgets/caps are conservative defaults tuned for
 * chat latency; both caps stay under the Opus 4.x 32k output limit.
 */
export function resolveEffortKnobs(
	effort: ChatEffort | undefined,
): EffortKnobs {
	switch (effort) {
		case "medium":
			return {
				modelType: ModelType.TEXT_LARGE,
				cotBudget: 4096,
				thinkingOn: true,
				maxOutputTokens: 8192,
			};
		case "high":
			return {
				modelType: ModelType.TEXT_LARGE,
				cotBudget: 16384,
				thinkingOn: true,
				maxOutputTokens: 32000,
			};
		default:
			return NO_EFFORT;
	}
}

/**
 * Runtime guard for the {@link ChatEffort} union. Validate untrusted input
 * (e.g. inbound `message.metadata.effort`) at the boundary before threading it
 * through the runtime.
 */
export function isChatEffort(value: unknown): value is ChatEffort {
	return (
		value === "none" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
	);
}
