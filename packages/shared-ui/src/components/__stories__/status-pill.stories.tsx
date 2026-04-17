import type { Meta, StoryObj } from "@storybook/react";
import { Check, X, Clock, AlertTriangle, Info as InfoIcon } from "lucide-react";
import { StatusPill, type StatusPillTone } from "../status-pill";

const meta: Meta<typeof StatusPill> = {
  title: "Editorial Primitives/StatusPill",
  component: StatusPill,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    tone: "success",
    label: "Confirmé",
  },
};
export default meta;

type Story = StoryObj<typeof StatusPill>;

export const Success: Story = { args: { tone: "success", label: "Confirmé" } };
export const Warning: Story = {
  args: { tone: "warning", label: "Paiement en attente" },
};
export const Danger: Story = { args: { tone: "danger", label: "Refusé" } };
export const Info: Story = {
  args: { tone: "info", label: "Enregistré · check-in" },
};
export const Neutral: Story = { args: { tone: "neutral", label: "Remboursé" } };
export const Gold: Story = { args: { tone: "gold", label: "ACCÈS VALIDE" } };
export const Clay: Story = { args: { tone: "clay", label: "Annulé" } };

const TONE_SAMPLES: Array<{
  tone: StatusPillTone;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    tone: "success",
    label: "Confirmé",
    icon: <Check className="h-3 w-3" aria-hidden="true" />,
  },
  {
    tone: "warning",
    label: "Paiement en attente",
    icon: <Clock className="h-3 w-3" aria-hidden="true" />,
  },
  {
    tone: "danger",
    label: "Paiement refusé",
    icon: <X className="h-3 w-3" aria-hidden="true" />,
  },
  {
    tone: "info",
    label: "Enregistré",
    icon: <InfoIcon className="h-3 w-3" aria-hidden="true" />,
  },
  { tone: "neutral", label: "Archivé", icon: null },
  { tone: "gold", label: "VIP", icon: null },
  {
    tone: "clay",
    label: "Annulé",
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  },
];

export const AllTones: Story = {
  name: "All 7 tones (grid)",
  parameters: { layout: "padded" },
  render: () => {
    return (
      <div className="grid max-w-[680px] grid-cols-2 gap-3 sm:grid-cols-3">
        {TONE_SAMPLES.map((s) => (
          <div
            key={s.tone}
            className="flex items-center justify-between rounded-card border px-4 py-3"
          >
            <span className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {s.tone}
            </span>
            <StatusPill tone={s.tone} label={s.label} icon={s.icon} />
          </div>
        ))}
      </div>
    );
  },
};
