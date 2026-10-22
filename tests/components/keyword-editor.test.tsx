// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KeywordEditor } from "@/components/keyword-editor";
import { StatusBadge } from "@/components/status-badge";

afterEach(cleanup);

function Harness({ initial }: { initial: string[] }) {
  const [keywords, setKeywords] = useState(initial);
  return (
    <>
      <KeywordEditor label="Keywords" keywords={keywords} target={5} onChange={setKeywords} />
      <span data-testid="value">{keywords.join("|")}</span>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;

describe("KeywordEditor", () => {
  it("adds keywords with Enter and skips case-insensitive duplicates", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["fox"]} />);
    const input = screen.getByRole("textbox", { name: "Add keyword to keywords" });
    await user.type(input, "snow{Enter}");
    await user.type(input, "FOX{Enter}");
    expect(value()).toBe("fox|snow");
    expect(screen.getByRole("status")).toHaveTextContent("1 duplicate keyword skipped.");
  });

  it("adds a pasted comma-separated list", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(screen.getByRole("textbox", { name: "Add keyword to keywords" }));
    await user.paste("winter, forest; wildlife");
    expect(value()).toBe("winter|forest|wildlife");
  });

  it("reorders and removes with labelled buttons", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c"]} />);
    await user.click(screen.getByRole("button", { name: "Move “c” earlier" }));
    expect(value()).toBe("a|c|b");
    expect(screen.getByRole("button", { name: "Move “a” earlier" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove “a”" }));
    expect(value()).toBe("c|b");
    expect(screen.getByRole("status")).toHaveTextContent("Removed “a”.");
  });

  it("removes duplicates on request", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["Fox", "fox", "snow"]} />);
    await user.click(screen.getByRole("button", { name: "Remove duplicates" }));
    expect(value()).toBe("Fox|snow");
  });

  it("removes the last keyword with Backspace in an empty input", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b"]} />);
    await user.type(screen.getByRole("textbox", { name: "Add keyword to keywords" }), "{Backspace}");
    expect(value()).toBe("a");
  });
});

describe("StatusBadge", () => {
  it("communicates status with text, not colour alone", () => {
    render(<StatusBadge status="processing" stage="analyzing" />);
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
    cleanup();
    render(<StatusBadge status="retrying" attempt={3} />);
    expect(screen.getByText("Retrying (attempt 3)")).toBeInTheDocument();
    cleanup();
    render(<StatusBadge status="needs_review" />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });
});
