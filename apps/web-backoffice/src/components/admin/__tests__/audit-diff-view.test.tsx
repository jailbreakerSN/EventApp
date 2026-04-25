import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditDiffView } from "../audit-diff-view";

/**
 * Sprint-1 B5 — contract tests for the audit details renderer.
 */
describe("AuditDiffView", () => {
  it("renders a side-by-side diff for { before, after } payloads", () => {
    render(
      <AuditDiffView
        details={{
          before: { name: "Alice", isActive: true },
          after: { name: "Alice", isActive: false },
        }}
      />,
    );

    expect(screen.getByText("Champ")).toBeInTheDocument();
    expect(screen.getByText("Avant")).toBeInTheDocument();
    expect(screen.getByText("Après")).toBeInTheDocument();
    expect(screen.getByText("isActive")).toBeInTheDocument();
    expect(screen.getByText("oui")).toBeInTheDocument();
    expect(screen.getByText("non")).toBeInTheDocument();
    // `name` didn't change so it should NOT appear in the diff body.
    expect(screen.queryByText("name")).not.toBeInTheDocument();
  });

  it("renders an empty-state when before and after are deeply equal", () => {
    render(
      <AuditDiffView
        details={{
          before: { name: "Alice", roles: ["admin"] },
          after: { name: "Alice", roles: ["admin"] },
        }}
      />,
    );

    expect(screen.getByText(/Aucune diff[ée]rence/i)).toBeInTheDocument();
  });

  it("renders a chip list for { changes: string[] } payloads", () => {
    render(<AuditDiffView details={{ changes: ["label", "expiresAt", "maxUses"] }} />);

    expect(screen.getByText("Champs modifiés")).toBeInTheDocument();
    expect(screen.getByText("label")).toBeInTheDocument();
    expect(screen.getByText("expiresAt")).toBeInTheDocument();
    expect(screen.getByText("maxUses")).toBeInTheDocument();
  });

  it("falls back to a JSON dump for unknown shapes", () => {
    render(<AuditDiffView details={{ message: "Foo bar", count: 42 }} />);

    // The rendered <pre> should contain the JSON-serialised payload.
    const pre = screen.getByText(/"message": "Foo bar"/);
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain('"count": 42');
  });

  it("formats ISO timestamps inside before/after using fr-SN/Dakar", () => {
    render(
      <AuditDiffView
        details={{
          before: { startDate: "2026-04-25T10:00:00.000Z" },
          after: { startDate: "2026-04-26T11:30:00.000Z" },
        }}
      />,
    );

    // The exact rendered string depends on the runner's locale data,
    // but it MUST contain the calendar day part — that's what we
    // care about (the formatter ran without throwing).
    expect(screen.getByText(/25\/04\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/26\/04\/2026/)).toBeInTheDocument();
  });
});
