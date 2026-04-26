import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommsComposer } from "../CommsComposer";
import type { CommsTemplate } from "@teranga/shared-types";

// PlanGate transitively pulls usePlanGating which pulls api-client; mock
// it to a transparent passthrough so render tests don't need network.
vi.mock("@/components/plan/PlanGate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const TEMPLATE: CommsTemplate = {
  id: "tpl-1",
  category: "reminder",
  label: "Rappel J-7",
  description: "Rappel envoyé une semaine avant l'événement.",
  title: "Rendez-vous dans une semaine — {{event}}",
  body: "Bonjour {{participant}}, c'est dans une semaine ! {{event}} se tient le {{date}}.",
  defaultChannels: ["email", "push"],
  timing: "À envoyer J-7",
};

describe("CommsComposer — form lifecycle", () => {
  it("hydrates the form fields when a template is supplied", () => {
    const onSubmit = vi.fn();
    render(
      <CommsComposer
        template={TEMPLATE}
        eventTitle="Mon Event"
        eventStartDate="2026-05-01T10:00:00.000Z"
        onSubmit={onSubmit}
      />,
    );

    const titleInput = screen.getByLabelText("Titre") as HTMLInputElement;
    const bodyInput = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(titleInput.value).toBe(TEMPLATE.title);
    expect(bodyInput.value).toBe(TEMPLATE.body);
  });

  it("renders a live preview that resolves {{event}} and {{date}} placeholders", () => {
    render(
      <CommsComposer
        template={TEMPLATE}
        eventTitle="Conférence Tech"
        eventStartDate="2026-05-01T10:00:00.000Z"
        onSubmit={vi.fn()}
      />,
    );
    // Preview reads "Rendez-vous dans une semaine — Conférence Tech"
    // (the {{event}} placeholder resolved to the event title).
    expect(screen.getByText(/Rendez-vous dans une semaine — Conférence Tech/)).toBeInTheDocument();
    // {{date}} resolves to a fr-SN long-form date — we check the year.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("disables the submit button when title or body is empty", () => {
    const onSubmit = vi.fn();
    render(<CommsComposer onSubmit={onSubmit} />);
    const button = screen.getByRole("button", { name: /^Envoyer$/ });
    expect(button).toBeDisabled();
  });

  it("invokes onSubmit with the right payload when the user clicks Envoyer", () => {
    const onSubmit = vi.fn();
    render(<CommsComposer onSubmit={onSubmit} eventTitle="Event" />);

    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "World" } });

    const button = screen.getByRole("button", { name: /^Envoyer$/ });
    fireEvent.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.title).toBe("Hello");
    expect(payload.body).toBe("World");
    expect(payload.channels).toEqual(["push", "in_app"]); // default selection
    expect(payload.scheduledAt).toBeNull(); // mode: now
  });

  it("toggles a channel on click (aria-pressed flips)", () => {
    render(<CommsComposer onSubmit={vi.fn()} />);
    const emailChip = screen.getByRole("button", { name: /Email/i });
    expect(emailChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(emailChip);
    expect(emailChip).toHaveAttribute("aria-pressed", "true");
  });

  it("respects the busy prop on the submit button label + disabled state", () => {
    render(
      <CommsComposer
        onSubmit={vi.fn()}
        busy
        template={TEMPLATE}
        eventTitle="x"
        eventStartDate="2026-05-01T10:00:00.000Z"
      />,
    );
    const button = screen.getByRole("button", { name: /Envoi…/i });
    expect(button).toBeDisabled();
  });

  it("switches scheduling mode and exposes the datetime input", () => {
    render(<CommsComposer onSubmit={vi.fn()} />);
    const scheduleBtn = screen.getByRole("button", { name: /Programmer l'envoi/i });
    fireEvent.click(scheduleBtn);
    expect(screen.getByLabelText("Date et heure d'envoi")).toBeInTheDocument();
  });
});
