import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Select } from "../select";
import { FormField } from "../form-field";

const meta: Meta<typeof Select> = {
  title: "Core Components/Select",
  component: Select,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Native `<select>` styled for the Teranga design system. Native because " +
          "(a) it composes cleanly with form libs, (b) it gets free mobile UX " +
          "(iOS picker, Android wheel), (c) it's keyboard-accessible by default. " +
          "For combo-box / search-in-list, build a custom component on top.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Select>;

// Bare-component stories add `aria-label` so they pass axe's `select-name`
// rule in isolation. In real apps, callers should wrap `<Select>` in a
// `<FormField label="…">` (see the `InsideFormField` showcase below) — the
// label association is the primary a11y pattern. The aria-label here is a
// story-level shortcut that documents the variant being demonstrated.

export const Default: Story = {
  render: () => (
    <Select aria-label="Ville (démo)" defaultValue="dakar">
      <option value="dakar">Dakar</option>
      <option value="thies">Thiès</option>
      <option value="saint-louis">Saint-Louis</option>
      <option value="ziguinchor">Ziguinchor</option>
    </Select>
  ),
};

export const WithPlaceholder: Story = {
  render: () => (
    <Select aria-label="Ville avec placeholder (démo)" defaultValue="">
      <option value="" disabled>
        — Sélectionnez une ville —
      </option>
      <option value="dakar">Dakar</option>
      <option value="thies">Thiès</option>
      <option value="saint-louis">Saint-Louis</option>
      <option value="ziguinchor">Ziguinchor</option>
    </Select>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Select aria-label="Ville verrouillée (démo)" disabled defaultValue="dakar">
      <option value="dakar">Dakar (verrouillé)</option>
      <option value="thies">Thiès</option>
    </Select>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Select aria-label="Ville groupée par pays (démo)" defaultValue="dakar">
      <optgroup label="Sénégal">
        <option value="dakar">Dakar</option>
        <option value="thies">Thiès</option>
        <option value="saint-louis">Saint-Louis</option>
      </optgroup>
      <optgroup label="Côte d'Ivoire">
        <option value="abidjan">Abidjan</option>
      </optgroup>
      <optgroup label="Togo">
        <option value="lome">Lomé</option>
      </optgroup>
    </Select>
  ),
};

export const InsideFormField: Story = {
  name: "Showcase: wired with FormField + label",
  render: () => {
    const [v, setV] = useState("conference");
    return (
      <FormField label="Catégorie de l'événement" htmlFor="cat-select" required>
        <Select id="cat-select" value={v} onChange={(e) => setV(e.target.value)}>
          <option value="conference">Conférence</option>
          <option value="workshop">Atelier</option>
          <option value="concert">Concert</option>
          <option value="festival">Festival</option>
          <option value="networking">Networking</option>
          <option value="sport">Sport</option>
          <option value="exhibition">Exposition</option>
          <option value="ceremony">Cérémonie</option>
          <option value="training">Formation</option>
          <option value="other">Autre</option>
        </Select>
      </FormField>
    );
  },
};
