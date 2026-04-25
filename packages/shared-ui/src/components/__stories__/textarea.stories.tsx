import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Textarea } from "../textarea";
import { FormField } from "../form-field";

const meta: Meta<typeof Textarea> = {
  title: "Core Components/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Multi-line text input. Inherits all native `<textarea>` attributes — " +
          "`rows`, `maxLength`, `placeholder`, `disabled`, `readOnly`. Pair with " +
          "`<FormField>` for label + error + hint plumbing.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

// Bare-component stories add `aria-label` so they pass axe's `label` rule
// in isolation. Real apps should wrap `<Textarea>` in a `<FormField>` — see
// the `InsideFormField` showcase below for the canonical pattern.

export const Empty: Story = {
  args: {
    "aria-label": "Description de l'événement (démo)",
    placeholder: "Décrivez votre événement en quelques lignes...",
    rows: 5,
  },
};

export const Filled: Story = {
  args: {
    "aria-label": "Description pré-remplie (démo)",
    defaultValue:
      "Le plus grand événement tech d'Afrique de l'Ouest. Deux jours de conférences, ateliers et networking avec les meilleurs talents tech du continent.",
    rows: 5,
  },
};

export const Disabled: Story = {
  args: {
    "aria-label": "Description verrouillée (démo)",
    defaultValue: "Description verrouillée par le modèle d'événement.",
    disabled: true,
    rows: 3,
  },
};

export const ReadOnly: Story = {
  args: {
    "aria-label": "Description en lecture seule (démo)",
    defaultValue:
      "Ce texte provient du serveur et n'est pas modifiable depuis cette interface.",
    readOnly: true,
    rows: 3,
  },
};

export const WithCharLimit: Story = {
  name: "With character limit (live counter)",
  render: () => {
    const MAX = 280;
    const [value, setValue] = useState("");
    const remaining = MAX - value.length;
    const tone =
      remaining <= 0 ? "text-destructive" : remaining < 30 ? "text-amber-600" : "text-muted-foreground";
    return (
      <div className="space-y-1.5">
        <Textarea
          rows={4}
          maxLength={MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Petit message (max ${MAX} caractères)`}
        />
        <p className={`text-xs ${tone}`} role="status" aria-live="polite">
          {remaining} caractère{Math.abs(remaining) > 1 ? "s" : ""} restant
          {Math.abs(remaining) > 1 ? "s" : ""}.
        </p>
      </div>
    );
  },
};

export const InsideFormField: Story = {
  name: "Showcase: wired in a FormField with hint + error",
  render: () => {
    const [value, setValue] = useState("ok");
    const error = value.length < 10 ? "Décrivez votre événement en au moins 10 caractères." : undefined;
    return (
      <FormField
        label="Description"
        htmlFor="event-desc-show"
        hint="Ce qui apparaîtra sur la page publique de l'événement (max 1 000 caractères)."
        error={error}
        required
      >
        <Textarea
          id="event-desc-show"
          rows={5}
          maxLength={1000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </FormField>
    );
  },
};
