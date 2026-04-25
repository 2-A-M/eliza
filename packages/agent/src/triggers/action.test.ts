import { describe, expect, it } from "vitest";
import {
  looksLikeTriggerDeleteIntent,
  looksLikeTriggerIntent,
  looksLikeTriggerUpdateIntent,
} from "./action.js";

describe("looksLikeTriggerIntent", () => {
  it("matches freeform 'every N <unit>' phrasings the keyword list does not cover", () => {
    expect(
      looksLikeTriggerIntent("every 2 minutes, write 'ping' to the log"),
    ).toBe(true);
    expect(looksLikeTriggerIntent("every 30 seconds do X")).toBe(true);
    expect(looksLikeTriggerIntent("every 6 hours, ping Discord")).toBe(true);
    expect(looksLikeTriggerIntent("every 3 days collect the digest")).toBe(
      true,
    );
  });

  it("still matches prompts handled by the existing keyword list", () => {
    expect(looksLikeTriggerIntent("please schedule a reminder")).toBe(true);
    expect(looksLikeTriggerIntent("set an alarm for 7am")).toBe(true);
    expect(looksLikeTriggerIntent("daily morning summary")).toBe(true);
  });

  it("rejects text that is neither keyword-matching nor a schedule phrase", () => {
    expect(looksLikeTriggerIntent("hello")).toBe(false);
    expect(looksLikeTriggerIntent("")).toBe(false);
    expect(looksLikeTriggerIntent("   ")).toBe(false);
  });

  it("does not match 'every' without a quantified unit", () => {
    expect(looksLikeTriggerIntent("every so often I want to")).toBe(false);
    expect(looksLikeTriggerIntent("every time you say that")).toBe(false);
  });
});

describe("looksLikeTriggerUpdateIntent (Session 16)", () => {
  it.each([
    "change that trigger to every 17 minutes",
    "update the ping schedule",
    "modify the cron expression",
    "edit the daily heartbeat",
    "rename the ping trigger to heartbeat",
    "adjust that automation to fire hourly",
    "tweak the recurring task",
    "reschedule the trigger to 3am",
    "switch the cron to every 15 minutes",
    "move the schedule to weekdays only",
  ])("matches update phrasing: %s", (text) => {
    expect(looksLikeTriggerUpdateIntent(text)).toBe(true);
  });

  it.each([
    "",
    "hello",
    "change my mind",
    "update my profile name",
    "edit this document",
    "rename the file",
  ])("rejects non-trigger edit text: %s", (text) => {
    expect(looksLikeTriggerUpdateIntent(text)).toBe(false);
  });
});

describe("looksLikeTriggerDeleteIntent (Session 16)", () => {
  it.each([
    "delete the status check trigger",
    "remove that cron",
    "cancel the schedule",
    "stop the ping heartbeat",
    "disable the daily digest trigger",
    "deactivate that automation",
    "turn off the recurring reminder",
    "kill the trigger",
    "end the schedule",
  ])("matches delete phrasing: %s", (text) => {
    expect(looksLikeTriggerDeleteIntent(text)).toBe(true);
  });

  it.each([
    "",
    "delete that message",
    "remove this paragraph",
    "cancel my subscription",
    "stop yelling at me",
  ])("rejects non-trigger delete text: %s", (text) => {
    expect(looksLikeTriggerDeleteIntent(text)).toBe(false);
  });
});
