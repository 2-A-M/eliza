import { describe, expect, it } from "vitest";
import { parseGoalCommand } from "./parsers";

describe("parseGoalCommand", () => {
  it("splits goal and comma-separated criteria after a criteria: marker", () => {
    const result = parseGoalCommand("build X criteria: a, b, c");
    expect(result).toEqual({
      goal: "build X",
      acceptanceCriteria: ["a", "b", "c"],
    });
  });

  it("is case-insensitive on the criteria marker", () => {
    expect(parseGoalCommand("do Y CRITERIA: one")).toEqual({
      goal: "do Y",
      acceptanceCriteria: ["one"],
    });
  });

  it("treats a bullet block as criteria when no marker is present", () => {
    const result = parseGoalCommand("build X\n- does A\n- does B");
    expect(result).toEqual({
      goal: "build X",
      acceptanceCriteria: ["does A", "does B"],
    });
  });

  it("returns no criteria for a plain goal", () => {
    expect(parseGoalCommand("just build X")).toEqual({
      goal: "just build X",
      acceptanceCriteria: [],
    });
  });

  it("returns null for empty input", () => {
    expect(parseGoalCommand("   ")).toBeNull();
  });

  it("returns null when only a criteria marker is given (no goal)", () => {
    expect(parseGoalCommand("criteria: a, b")).toBeNull();
  });

  it("strips bullet dashes and blanks inside the criteria list", () => {
    const result = parseGoalCommand("ship it criteria:\n- a\n- b\n\n- c");
    expect(result?.acceptanceCriteria).toEqual(["a", "b", "c"]);
  });
});
