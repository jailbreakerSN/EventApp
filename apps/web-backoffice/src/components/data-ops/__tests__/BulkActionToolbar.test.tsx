import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tag, Trash2 } from "lucide-react";
import { BulkActionToolbar } from "../BulkActionToolbar";

// ─── BulkActionToolbar — render contract ────────────────────────────────
//
// Phase O7: the toolbar appears whenever `selectedCount > 0`. Tests
// pin: the self-hide on empty selection, the FR pluralisation of
// the counter, the destructive variant styling cue (via class), the
// click handlers, and the clear-selection escape hatch.

describe("BulkActionToolbar — visibility", () => {
  it("renders nothing when selectedCount is 0", () => {
    const { container } = render(
      <BulkActionToolbar selectedCount={0} actions={[]} onClearSelection={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the counter when selectedCount > 0", () => {
    render(<BulkActionToolbar selectedCount={3} actions={[]} onClearSelection={() => {}} />);
    expect(screen.getByText("3 sélectionnés")).toBeInTheDocument();
  });

  it("uses singular form when selectedCount is 1", () => {
    render(<BulkActionToolbar selectedCount={1} actions={[]} onClearSelection={() => {}} />);
    expect(screen.getByText("1 sélectionné")).toBeInTheDocument();
  });
});

describe("BulkActionToolbar — actions", () => {
  it("renders one button per action with the right label", () => {
    const tagFn = vi.fn();
    const cancelFn = vi.fn();
    render(
      <BulkActionToolbar
        selectedCount={2}
        actions={[
          { id: "tag", label: "Tag", icon: Tag, onClick: tagFn },
          {
            id: "cancel",
            label: "Annuler",
            icon: Trash2,
            onClick: cancelFn,
            variant: "destructive",
          },
        ]}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Tag/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Annuler/i })).toBeInTheDocument();
  });

  it("invokes the action handler on click", () => {
    const tagFn = vi.fn();
    render(
      <BulkActionToolbar
        selectedCount={2}
        actions={[{ id: "tag", label: "Tag", onClick: tagFn }]}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Tag/i }));
    expect(tagFn).toHaveBeenCalledTimes(1);
  });

  it("disables the button when action.disabled is true (no click)", () => {
    const tagFn = vi.fn();
    render(
      <BulkActionToolbar
        selectedCount={2}
        actions={[{ id: "tag", label: "Tag", onClick: tagFn, disabled: true }]}
        onClearSelection={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /Tag/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(tagFn).not.toHaveBeenCalled();
  });

  it("invokes onClearSelection when the user clicks Désélectionner", () => {
    const clearFn = vi.fn();
    render(<BulkActionToolbar selectedCount={2} actions={[]} onClearSelection={clearFn} />);
    fireEvent.click(screen.getByRole("button", { name: /Désélectionner/i }));
    expect(clearFn).toHaveBeenCalledTimes(1);
  });
});

describe("BulkActionToolbar — destructive variant cue", () => {
  it("applies a red tint class to destructive actions", () => {
    render(
      <BulkActionToolbar
        selectedCount={1}
        actions={[{ id: "x", label: "Supprimer", onClick: () => {}, variant: "destructive" }]}
        onClearSelection={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /Supprimer/i });
    expect(btn.className).toContain("text-red-700");
  });
});
