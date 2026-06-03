// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadChatEffort,
  normalizeChatEffort,
  saveChatEffort,
} from "./persistence";

describe("chat effort persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults to none when nothing is stored", () => {
    expect(loadChatEffort()).toBe("none");
  });

  it("round-trips a stored effort level", () => {
    saveChatEffort("high");
    expect(loadChatEffort()).toBe("high");
    saveChatEffort("medium");
    expect(loadChatEffort()).toBe("medium");
  });

  it("normalizes unknown values to none", () => {
    expect(normalizeChatEffort("bogus")).toBe("none");
    expect(normalizeChatEffort(null)).toBe("none");
    expect(normalizeChatEffort("low")).toBe("low");
  });
});
