import type { Meta, StoryObj } from "@storybook/react";
import { Stepper } from "../stepper";

const meta: Meta<typeof Stepper> = {
  title: "Editorial Primitives/Stepper",
  component: Stepper,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    steps: [{ label: "Billet" }, { label: "Paiement" }, { label: "Confirmation" }],
    kickerFormatter: (n, total) => `Étape ${n}/${total}`,
    ariaLabel: "Progression de l’inscription",
  },
};
export default meta;

type Story = StoryObj<typeof Stepper>;

export const Step1: Story = {
  args: { currentStep: 1 },
  name: "Step 1 of 3 (Billet)",
};

export const Step2: Story = {
  args: { currentStep: 2 },
  name: "Step 2 of 3 (Paiement)",
};

export const Step3: Story = {
  args: { currentStep: 3 },
  name: "Step 3 of 3 (Confirmation)",
};

export const FourSteps: Story = {
  args: {
    steps: [
      { label: "Informations" },
      { label: "Billet" },
      { label: "Paiement" },
      { label: "Confirmation" },
    ],
    currentStep: 2,
  },
  name: "4-step flow (current: 2)",
};

export const LabelsHiddenMobile: Story = {
  args: { currentStep: 2 },
  name: "Labels hidden on mobile",
  parameters: {
    viewport: { defaultViewport: "mobile" },
  },
};
