import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { PaymentMethodCard } from "../payment-method-card";

type PaymentMethod = "wave" | "om" | "free" | "card";

const METHODS: Record<
  PaymentMethod,
  { glyph: string; accent: string; name: string; description: string }
> = {
  wave: {
    glyph: "W",
    accent: "#1DC8F1",
    name: "Wave",
    description: "Paiement instantané via l’application Wave",
  },
  om: {
    glyph: "OM",
    accent: "#FF7900",
    name: "Orange Money",
    description: "Compte Orange Money Sénégal",
  },
  free: {
    glyph: "F",
    accent: "#CD0067",
    name: "Free Money",
    description: "Portefeuille Free Money",
  },
  card: {
    glyph: "CB",
    accent: "#635bff",
    name: "Carte bancaire",
    description: "Visa, Mastercard ou Carte Africaine",
  },
};

const meta: Meta<typeof PaymentMethodCard> = {
  title: "Editorial Primitives/PaymentMethodCard",
  component: PaymentMethodCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  render: (args) => (
    <div style={{ width: 420 }}>
      <PaymentMethodCard {...args} />
    </div>
  ),
  args: {
    ...METHODS.wave,
    selected: false,
  },
};
export default meta;

type Story = StoryObj<typeof PaymentMethodCard>;

export const Unselected: Story = {
  args: { ...METHODS.wave, selected: false },
};

export const Selected: Story = {
  args: { ...METHODS.wave, selected: true },
};

export const Disabled: Story = {
  args: {
    ...METHODS.card,
    selected: false,
    disabled: true,
  },
  render: (args) => (
    <div style={{ width: 420 }} className="opacity-60">
      <PaymentMethodCard {...args} />
    </div>
  ),
};

export const AllGlyphTones: Story = {
  name: "All four glyph tones",
  parameters: { layout: "padded" },
  render: () => {
    return (
      <div className="grid max-w-[460px] gap-3">
        {(Object.keys(METHODS) as PaymentMethod[]).map((key) => (
          <PaymentMethodCard
            key={key}
            {...METHODS[key]}
            selected={key === "om"}
          />
        ))}
      </div>
    );
  },
};

/**
 * Interactive radio group — clicking a card selects it and deselects others.
 * Exercises the `@storybook/addon-interactions` path used by the
 * participant app’s payment step.
 */
export const InteractiveRadioGroup: Story = {
  name: "Interactive radio group",
  parameters: { layout: "padded" },
  render: () => {
    function Group() {
      const [selected, setSelected] = useState<PaymentMethod>("wave");
      return (
        <div
          role="radiogroup"
          aria-label="Moyen de paiement"
          className="grid max-w-[460px] gap-3"
        >
          {(Object.keys(METHODS) as PaymentMethod[]).map((key) => (
            <PaymentMethodCard
              key={key}
              {...METHODS[key]}
              selected={selected === key}
              onClick={() => setSelected(key)}
              data-testid={`pm-${key}`}
            />
          ))}
        </div>
      );
    }
    return <Group />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const wave = await canvas.findByTestId("pm-wave");
    const om = await canvas.findByTestId("pm-om");

    await expect(wave).toHaveAttribute("aria-checked", "true");
    await userEvent.click(om);
    await expect(om).toHaveAttribute("aria-checked", "true");
    await expect(wave).toHaveAttribute("aria-checked", "false");
  },
};
