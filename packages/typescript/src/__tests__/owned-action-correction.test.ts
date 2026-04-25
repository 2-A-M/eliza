import { describe, expect, it } from "vitest";
import { findOwnedActionCorrectionFromMetadata } from "../services/message.ts";

describe("findOwnedActionCorrectionFromMetadata", () => {
	it("returns null when planner already included an explicit-intent action (SPAWN_AGENT)", () => {
		// Regression: the metadata corrector scores actions by keyword overlap
		// against the user message. SPAWN_AGENT has no keywords to match, so for
		// any coding-delegation request the scorer would otherwise rank a cross-
		// channel send action higher and silently override the planner's
		// deliberate SPAWN_AGENT choice, breaking the delegation.
		const result = findOwnedActionCorrectionFromMetadata(
			{ actions: [] },
			{ content: { text: "send a small pr to elizaOS/eliza" } },
			{ actions: ["REPLY", "SPAWN_AGENT"] },
		);
		expect(result).toBeNull();
	});

	it("returns null when planner picked SPAWN_AGENT alone", () => {
		const result = findOwnedActionCorrectionFromMetadata(
			{ actions: [] },
			{ content: { text: "build me an app that tracks coffee" } },
			{ actions: ["SPAWN_AGENT"] },
		);
		expect(result).toBeNull();
	});

	it("returns null when response has no actions", () => {
		const result = findOwnedActionCorrectionFromMetadata(
			{ actions: [] },
			{ content: { text: "anything" } },
			{ actions: [] },
		);
		expect(result).toBeNull();
	});

	it("returns a suggestion when the planner chose a low-scoring owned action", () => {
		// Positive-path guard: a future refactor that always returned null from
		// the explicit-intent early-return would still pass the three cases
		// above. This keeps the corrector's real job under test — upgrading a
		// weak planner pick to a clearly better owned action by keyword overlap.
		const runtime = {
			actions: [
				{
					name: "OWNER_SEND_MESSAGE",
					description:
						"Send a discord message to a contact or channel when the user asks to send, text, ping, or dm someone. Use this for owner send workflows.",
					tags: ["workflow"],
					similes: ["send discord message"],
				},
				{
					name: "READ_CALENDAR",
					description: "Read the user's calendar.",
				},
			],
		};
		const result = findOwnedActionCorrectionFromMetadata(
			runtime,
			{ content: { text: "send a discord message to the team channel" } },
			{ actions: ["READ_CALENDAR"] },
		);
		expect(result).not.toBeNull();
		expect(result?.actionName).toBe("OWNER_SEND_MESSAGE");
	});

	// Session 15 regression — before this fix, an LLM pick of CREATE_CRON for
	// "every 9 minutes write a ping log entry" was overridden to LIFE by the
	// keyword-overlap scorer because LIFE's multi-paragraph description
	// mentions reminders, alarms, and recurring verbs. That reroute broke
	// DoD-F1 on page-automations because LIFE's handler (even after
	// Session 14's dispatch-time scope guard) short-circuits to empty and no
	// trigger is created. Adding CREATE_TRIGGER_TASK + its schedule similes
	// to EXPLICIT_INTENT_ACTIONS makes the planner's schedule picks
	// authoritative, same as SPAWN_AGENT.
	describe("Session 15 — schedule-intent planner picks are authoritative", () => {
		const runtime = {
			actions: [
				{
					name: "LIFE",
					// Truncated real LIFE description with reminder/alarm vocabulary.
					description:
						"Manage the user's personal routines, habits, goals, reminders, alarms, and escalation settings through LifeOps. USE this action for: creating, editing, or deleting tasks, habits, routines, and goals; todo and goal requests like 'add a todo', 'remember to call mom', or 'set a goal'; setting one-off alarms or wake-up reminders.",
					similes: ["CREATE_HABIT", "SET_ALARM", "CREATE_TODO"],
				},
				{
					name: "CREATE_TRIGGER_TASK",
					description:
						"Create a scheduled task that executes on a schedule (interval, once, or cron). Use when the user wants to schedule, automate, or create a recurring/timed task, trigger, or heartbeat.",
					similes: [
						"CREATE_TRIGGER",
						"SCHEDULE_TRIGGER",
						"SCHEDULE_TASK",
						"CREATE_HEARTBEAT",
						"SCHEDULE_HEARTBEAT",
						"CREATE_AUTOMATION",
						"SCHEDULE_AUTOMATION",
						"CREATE_CRON",
						"CREATE_RECURRING",
					],
				},
			],
		};

		it.each([
			"CREATE_TRIGGER_TASK",
			"CREATE_CRON",
			"CREATE_TRIGGER",
			"SCHEDULE_TRIGGER",
			"SCHEDULE_TASK",
			"CREATE_HEARTBEAT",
			"SCHEDULE_HEARTBEAT",
			"CREATE_AUTOMATION",
			"SCHEDULE_AUTOMATION",
			"CREATE_RECURRING",
		])(
			"treats %s as explicit intent (no override to LIFE)",
			(actionName) => {
				const result = findOwnedActionCorrectionFromMetadata(
					runtime,
					{ content: { text: "every 9 minutes write a ping log entry" } },
					{ actions: [actionName] },
				);
				expect(result).toBeNull();
			},
		);
	});

	// Session 16 — UPDATE_TRIGGER_TASK + DELETE_TRIGGER_TASK extend the same
	// EXPLICIT_INTENT_ACTIONS protection CREATE_TRIGGER_TASK got. Edit and
	// delete intents ("change the ping log to every 15 minutes", "delete
	// the status check trigger") keyword-overlap with LIFE's reminder/habit
	// rename verbs, so without the whitelist the corrector reroutes the
	// planner's correct pick to LIFE — same failure mode Session 15 saw for
	// CREATE, just on the UPDATE/DELETE lifecycle instead of the CREATE one.
	describe("Session 16 — trigger UPDATE/DELETE picks are authoritative", () => {
		const runtime = {
			actions: [
				{
					name: "LIFE",
					description:
						"Manage the user's personal routines, habits, goals, reminders, alarms, and escalation settings through LifeOps. Edit, rename, update, delete, or remove existing habits, goals, and reminders. Cancel or stop existing tasks.",
					similes: ["RENAME_HABIT", "DELETE_HABIT", "CANCEL_REMINDER"],
				},
				{
					name: "UPDATE_TRIGGER_TASK",
					description:
						"Update an existing scheduled trigger's schedule, name, or instructions.",
					similes: [
						"UPDATE_TRIGGER",
						"MODIFY_TRIGGER",
						"EDIT_TRIGGER",
						"CHANGE_TRIGGER",
						"RENAME_TRIGGER",
						"UPDATE_SCHEDULE",
						"MODIFY_SCHEDULE",
						"EDIT_SCHEDULE",
						"CHANGE_SCHEDULE",
						"RESCHEDULE_TRIGGER",
						"ADJUST_SCHEDULE",
					],
				},
				{
					name: "DELETE_TRIGGER_TASK",
					description:
						"Delete an existing scheduled trigger, cron, interval, or heartbeat.",
					similes: [
						"DELETE_TRIGGER",
						"REMOVE_TRIGGER",
						"CANCEL_TRIGGER",
						"STOP_TRIGGER",
						"DISABLE_TRIGGER",
						"CANCEL_SCHEDULE",
						"STOP_SCHEDULE",
						"REMOVE_SCHEDULE",
						"DELETE_SCHEDULE",
					],
				},
			],
		};

		it.each([
			"UPDATE_TRIGGER_TASK",
			"UPDATE_TRIGGER",
			"MODIFY_TRIGGER",
			"EDIT_TRIGGER",
			"CHANGE_TRIGGER",
			"RENAME_TRIGGER",
			"UPDATE_SCHEDULE",
			"MODIFY_SCHEDULE",
			"EDIT_SCHEDULE",
			"CHANGE_SCHEDULE",
			"RESCHEDULE_TRIGGER",
			"ADJUST_SCHEDULE",
		])(
			"treats update-intent %s as explicit (no override to LIFE)",
			(actionName) => {
				const result = findOwnedActionCorrectionFromMetadata(
					runtime,
					{ content: { text: "change the ping log to every 15 minutes" } },
					{ actions: [actionName] },
				);
				expect(result).toBeNull();
			},
		);

		it.each([
			"DELETE_TRIGGER_TASK",
			"DELETE_TRIGGER",
			"REMOVE_TRIGGER",
			"CANCEL_TRIGGER",
			"STOP_TRIGGER",
			"DISABLE_TRIGGER",
			"CANCEL_SCHEDULE",
			"STOP_SCHEDULE",
			"REMOVE_SCHEDULE",
			"DELETE_SCHEDULE",
		])(
			"treats delete-intent %s as explicit (no override to LIFE)",
			(actionName) => {
				const result = findOwnedActionCorrectionFromMetadata(
					runtime,
					{ content: { text: "delete the status check trigger" } },
					{ actions: [actionName] },
				);
				expect(result).toBeNull();
			},
		);
	});

	// Session 16 — @elizaos/plugin-n8n-workflow. Same systemic issue as the
	// trigger lifecycle actions: a prompt like "create an n8n workflow that
	// reads my Gmail and posts a summary to Discord" keyword-overlaps with
	// OWNER_INBOX (Gmail/summary) and OWNER_RELATIONSHIP (Discord/post)
	// far more than with CREATE_N8N_WORKFLOW's short description. Without
	// the whitelist protection the corrector silently reroutes the
	// planner's correct pick and F2 (workflow creation via chat) breaks.
	describe("Session 16 — n8n-workflow plugin picks are authoritative", () => {
		const runtime = {
			actions: [
				{
					name: "OWNER_INBOX",
					// Truncated real OWNER_INBOX description mentioning Gmail /
					// summaries / discord — enough to win a keyword-overlap
					// race against CREATE_N8N_WORKFLOW's short description.
					description:
						"Manage the owner's Gmail inbox, email triage, daily summaries, and cross-channel inbox review. Handles reading email, summarizing threads, drafting replies, and posting digests to discord or other channels.",
					similes: [
						"GMAIL",
						"CHECK_INBOX",
						"DAILY_BRIEF",
						"INBOX_DIGEST",
					],
				},
				{
					name: "CREATE_N8N_WORKFLOW",
					description:
						"Generate and deploy an n8n workflow from natural language.",
					similes: [
						"CREATE_WORKFLOW",
						"BUILD_WORKFLOW",
						"GENERATE_WORKFLOW",
						"MAKE_AUTOMATION",
						"SETUP_WORKFLOW",
						"CONFIRM_WORKFLOW",
						"DEPLOY_WORKFLOW",
					],
				},
				{
					name: "DELETE_N8N_WORKFLOW",
					description: "Delete an n8n workflow.",
					similes: ["DELETE_WORKFLOW", "REMOVE_WORKFLOW", "DESTROY_WORKFLOW"],
				},
			],
		};

		it.each([
			"CREATE_N8N_WORKFLOW",
			"CREATE_WORKFLOW",
			"BUILD_WORKFLOW",
			"GENERATE_WORKFLOW",
			"MAKE_AUTOMATION",
			"SETUP_WORKFLOW",
			"CONFIRM_WORKFLOW",
			"DEPLOY_WORKFLOW",
		])(
			"treats n8n create-intent %s as explicit (no override to OWNER_INBOX)",
			(actionName) => {
				const result = findOwnedActionCorrectionFromMetadata(
					runtime,
					{
						content: {
							text: "create an n8n workflow that reads my Gmail and posts a summary to Discord",
						},
					},
					{ actions: [actionName] },
				);
				expect(result).toBeNull();
			},
		);

		it.each(["DELETE_N8N_WORKFLOW", "DELETE_WORKFLOW", "REMOVE_WORKFLOW"])(
			"treats n8n delete-intent %s as explicit",
			(actionName) => {
				const result = findOwnedActionCorrectionFromMetadata(
					runtime,
					{ content: { text: "delete the gmail-to-discord n8n workflow" } },
					{ actions: [actionName] },
				);
				expect(result).toBeNull();
			},
		);
	});
});
