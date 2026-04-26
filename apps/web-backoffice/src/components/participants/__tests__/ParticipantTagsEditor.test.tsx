import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ParticipantTagsEditor } from "../ParticipantTagsEditor";

// ─── ParticipantTagsEditor — render contract ──────────────────────────────
//
// Phase O7. Tests pin: tag chip rendering + remove, add via Enter,
// duplicate guard, notes textarea wiring, save callback fires once.

describe("ParticipantTagsEditor — tag chips", () => {
  it("renders one chip per current tag", () => {
    render(
      <ParticipantTagsEditor
        tags={["VIP", "Press"]}
        notes=""
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("Press")).toBeInTheDocument();
  });

  it("invokes onChange minus the tag when its X button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ParticipantTagsEditor
        tags={["VIP", "Press"]}
        notes=""
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Retirer le tag VIP/i }));
    expect(onChange).toHaveBeenCalledWith({ tags: ["Press"], notes: "" });
  });

  it("appends a new tag via Enter on the input", () => {
    const onChange = vi.fn();
    render(<ParticipantTagsEditor tags={["VIP"]} notes="" onChange={onChange} onSave={vi.fn()} />);
    const input = screen.getByLabelText("Nouveau tag");
    fireEvent.change(input, { target: { value: "Speaker" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ tags: ["VIP", "Speaker"], notes: "" });
  });

  it("does not duplicate an existing tag on Enter", () => {
    const onChange = vi.fn();
    render(<ParticipantTagsEditor tags={["VIP"]} notes="" onChange={onChange} onSave={vi.fn()} />);
    const input = screen.getByLabelText("Nouveau tag");
    fireEvent.change(input, { target: { value: "VIP" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ParticipantTagsEditor — notes + save", () => {
  it("forwards notes edits to onChange", () => {
    const onChange = vi.fn();
    render(<ParticipantTagsEditor tags={[]} notes="" onChange={onChange} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Note organisateur"), {
      target: { value: "Sponsor potentiel" },
    });
    expect(onChange).toHaveBeenCalledWith({ tags: [], notes: "Sponsor potentiel" });
  });

  it("invokes onSave when the user clicks the save button", () => {
    const onSave = vi.fn();
    render(<ParticipantTagsEditor tags={[]} notes="" onChange={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables the save button when busy=true", () => {
    render(<ParticipantTagsEditor tags={[]} notes="" busy onChange={vi.fn()} onSave={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /Enregistrement/i });
    expect(btn).toBeDisabled();
  });
});
