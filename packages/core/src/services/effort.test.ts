import { describe, expect, it } from "vitest";
import { ModelType } from "../types/model";
import { isChatEffort, resolveEffortKnobs } from "./effort";

describe("resolveEffortKnobs", () => {
	it("leaves none/low/unknown byte-identical to today (no pass, no thinking)", () => {
		for (const effort of ["none", "low", undefined] as const) {
			const knobs = resolveEffortKnobs(effort);
			expect(knobs.thinkingOn).toBe(false);
			expect(knobs.modelType).toBeUndefined();
			expect(knobs.cotBudget).toBe(0);
			expect(knobs.maxOutputTokens).toBe(0);
		}
	});

	it("bumps medium to TEXT_LARGE with a thinking budget and headroom", () => {
		const knobs = resolveEffortKnobs("medium");
		expect(knobs.modelType).toBe(ModelType.TEXT_LARGE);
		expect(knobs.thinkingOn).toBe(true);
		expect(knobs.cotBudget).toBeGreaterThan(0);
		expect(knobs.maxOutputTokens).toBeGreaterThan(knobs.cotBudget);
	});

	it("gives high a larger thinking budget than medium", () => {
		expect(resolveEffortKnobs("high").cotBudget).toBeGreaterThan(
			resolveEffortKnobs("medium").cotBudget,
		);
	});

	it("keeps every output cap above its budget and under the Opus 4.x 32k limit", () => {
		for (const effort of ["medium", "high"] as const) {
			const knobs = resolveEffortKnobs(effort);
			expect(knobs.maxOutputTokens).toBeGreaterThan(knobs.cotBudget);
			expect(knobs.maxOutputTokens).toBeLessThanOrEqual(32000);
		}
	});
});

describe("isChatEffort", () => {
	it("accepts the four valid levels", () => {
		for (const v of ["none", "low", "medium", "high"]) {
			expect(isChatEffort(v)).toBe(true);
		}
	});

	it("rejects anything else", () => {
		for (const v of ["HIGH", "", "extreme", 1, null, undefined, {}]) {
			expect(isChatEffort(v)).toBe(false);
		}
	});
});
