import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FormField } from "../form-field";
import { Input } from "../input";
import { Textarea } from "../textarea";
import { Select } from "../select";

const meta: Meta<typeof FormField> = {
  title: "Core Components/FormField",
  component: FormField,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Wraps any input with a label, optional hint, optional error, and a " +
          "valid-state checkmark. Sets `aria-describedby` to whichever of " +
          "hint / error is currently rendered. Pass `state=\"valid\"` after " +
          "passing onBlur validation — the green checkmark gives the user " +
          "explicit feedback (frontend-design: never leave the user guessing).",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof FormField>;

export const Idle: Story = {
  render: () => (
    <FormField label="Nom de l'événement" htmlFor="event-title">
      <Input id="event-title" placeholder="Dakar Tech Summit 2026" />
    </FormField>
  ),
};

export const Required: Story = {
  render: () => (
    <FormField label="Email" htmlFor="email" required>
      <Input id="email" type="email" placeholder="moussa@example.com" />
    </FormField>
  ),
};

export const WithHint: Story = {
  render: () => (
    <FormField
      label="Slug de l'événement"
      htmlFor="event-slug"
      hint="Utilisé dans l'URL publique. Lettres minuscules, chiffres et tirets."
    >
      <Input id="event-slug" placeholder="dakar-tech-summit-2026" />
    </FormField>
  ),
};

export const WithError: Story = {
  render: () => (
    <FormField
      label="Email"
      htmlFor="email-err"
      error="L'adresse email n'est pas valide."
      required
    >
      <Input id="email-err" defaultValue="moussa@" />
    </FormField>
  ),
};

export const Valid: Story = {
  name: "Valid state (post-validation checkmark)",
  render: () => (
    <FormField label="Nom complet" htmlFor="name-valid" state="valid">
      <Input id="name-valid" defaultValue="Moussa Diop" />
    </FormField>
  ),
};

export const Textarea_: Story = {
  name: "With textarea",
  render: () => (
    <FormField
      label="Description"
      htmlFor="event-desc"
      hint="Ce qui apparaîtra sur la page publique de l'événement."
    >
      <Textarea
        id="event-desc"
        rows={5}
        placeholder="Décrivez votre événement en quelques lignes..."
      />
    </FormField>
  ),
};

export const SelectField: Story = {
  name: "With select",
  render: () => (
    <FormField label="Catégorie" htmlFor="event-cat" required>
      <Select id="event-cat" defaultValue="conference">
        <option value="conference">Conférence</option>
        <option value="workshop">Atelier</option>
        <option value="concert">Concert</option>
        <option value="festival">Festival</option>
      </Select>
    </FormField>
  ),
};

export const FormShowcase: Story = {
  name: "Showcase: 4 fields wired with live validation",
  render: () => {
    const [email, setEmail] = useState("");
    const [touched, setTouched] = useState(false);
    const emailError =
      touched && !/^[^@]+@[^@]+\.[^@]+$/.test(email)
        ? "Format d'email invalide."
        : undefined;
    const emailValid = touched && !emailError && email.length > 0 ? "valid" : undefined;
    return (
      <form className="flex flex-col gap-4">
        <FormField label="Nom complet" htmlFor="show-name" required>
          <Input id="show-name" defaultValue="Moussa Diop" />
        </FormField>
        <FormField
          label="Email"
          htmlFor="show-email"
          required
          error={emailError}
          state={emailValid}
        >
          <Input
            id="show-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </FormField>
        <FormField
          label="Téléphone"
          htmlFor="show-phone"
          hint="Format international avec indicatif (+221 …)."
        >
          <Input id="show-phone" placeholder="+221 77 123 45 67" />
        </FormField>
        <FormField label="Message" htmlFor="show-msg">
          <Textarea id="show-msg" rows={3} />
        </FormField>
      </form>
    );
  },
};
