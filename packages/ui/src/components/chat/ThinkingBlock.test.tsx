// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock";

afterEach(cleanup);

describe("ThinkingBlock", () => {
  it("renders nothing when empty and not streaming", () => {
    const { container } = render(<ThinkingBlock content="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the label collapsed by default and reveals content on toggle", () => {
    render(<ThinkingBlock content="reasoning body" />);
    const trigger = screen.getByText("Thinking");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByText("reasoning body")).toBeTruthy();
  });

  it("shows a streaming affordance while reasoning is still arriving", () => {
    render(<ThinkingBlock content="" streaming />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });
});
