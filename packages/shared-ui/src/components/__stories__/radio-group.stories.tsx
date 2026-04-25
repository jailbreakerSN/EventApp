import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { RadioGroup } from "../radio-group";
import { FormField } from "../form-field";

const meta: Meta<typeof RadioGroup> = {
  title: "Core Components/RadioGroup",
  component: RadioGroup,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Accessible radio group rendered as a `<fieldset>` for screen readers. " +
          "Use `orientation=\"horizontal\"` for ≤ 3 short options; `vertical` " +
          "(default) for longer labels. The `name` is required and must be unique " +
          "per group on the page.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof RadioGroup>;

export const VerticalDefault: Story = {
  render: () => {
    const [value, setValue] = useState("standard");
    return (
      <RadioGroup
        name="ticket-type"
        value={value}
        onChange={setValue}
        options={[
          { value: "standard", label: "Standard — gratuit" },
          { value: "vip", label: "VIP — 25 000 XOF (déjeuner inclus)" },
          { value: "press", label: "Presse — sur invitation uniquement" },
        ]}
      />
    );
  },
};

export const Horizontal: Story = {
  render: () => {
    const [value, setValue] = useState("monthly");
    return (
      <RadioGroup
        name="cycle"
        orientation="horizontal"
        value={value}
        onChange={setValue}
        options={[
          { value: "monthly", label: "Mensuel" },
          { value: "annual", label: "Annuel (-20 %)" },
        ]}
      />
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <RadioGroup
      name="locked"
      disabled
      value="starter"
      options={[
        { value: "free", label: "Free" },
        { value: "starter", label: "Starter (sélectionné — verrouillé)" },
        { value: "pro", label: "Pro" },
      ]}
    />
  ),
};

export const InsideFormField: Story = {
  name: "Showcase: wired with FormField label + hint",
  render: () => {
    const [value, setValue] = useState("in_person");
    return (
      <FormField
        label="Format de l'événement"
        hint="Le format hybride permet la participation à distance via streaming."
      >
        <RadioGroup
          name="format"
          value={value}
          onChange={setValue}
          options={[
            { value: "in_person", label: "Présentiel" },
            { value: "online", label: "En ligne (streaming)" },
            { value: "hybrid", label: "Hybride" },
          ]}
        />
      </FormField>
    );
  },
};

export const FullPlanPicker: Story = {
  name: "Showcase: 4-tier plan picker",
  render: () => {
    const [value, setValue] = useState("pro");
    return (
      <RadioGroup
        name="plan"
        value={value}
        onChange={setValue}
        options={[
          { value: "free", label: "Free — jusqu'à 3 événements, 50 inscrits/événement" },
          { value: "starter", label: "Starter — 9 900 XOF/mois — 10 événements, 200 inscrits" },
          { value: "pro", label: "Pro — 29 900 XOF/mois — événements illimités, 2 000 inscrits" },
          { value: "enterprise", label: "Enterprise — sur devis — illimité, white-label, API" },
        ]}
      />
    );
  },
};
