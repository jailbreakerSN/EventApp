import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Switch } from "../switch";
import { FormField } from "../form-field";

const meta: Meta<typeof Switch> = {
  title: "Core Components/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "On/off toggle following the WAI-ARIA `role=\"switch\"` pattern. Use for " +
          "settings that take effect immediately (notifications, dark mode, " +
          "marketing opt-in). For staged form fields that need a Save button, " +
          "use a `<Checkbox>` instead.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Switch>;

export const OffControlled: Story = {
  name: "Off (controlled)",
  render: () => {
    const [on, setOn] = useState(false);
    return <Switch checked={on} onCheckedChange={setOn} label="Recevoir les notifications" />;
  },
};

export const OnControlled: Story = {
  name: "On (controlled)",
  render: () => {
    const [on, setOn] = useState(true);
    return <Switch checked={on} onCheckedChange={setOn} label="Notifications activées" />;
  },
};

export const Disabled: Story = {
  render: () => (
    <Switch disabled label="Option indisponible — passer au plan Pro" />
  ),
};

export const DisabledChecked: Story = {
  render: () => <Switch disabled checked label="Verrouillé en position activée" />,
};

export const NotificationSettings: Story = {
  name: "Showcase: notification preferences pane",
  parameters: { layout: "padded" },
  render: () => {
    const [email, setEmail] = useState(true);
    const [push, setPush] = useState(true);
    const [sms, setSms] = useState(false);
    const [marketing, setMarketing] = useState(false);
    return (
      <div className="flex flex-col gap-4">
        <FormField label="Email" htmlFor="opt-email">
          <Switch checked={email} onCheckedChange={setEmail} label="Email" />
        </FormField>
        <FormField label="Push (mobile + web)" htmlFor="opt-push">
          <Switch checked={push} onCheckedChange={setPush} label="Push" />
        </FormField>
        <FormField
          label="SMS"
          htmlFor="opt-sms"
          hint="Disponible avec le plan Pro et supérieur."
        >
          <Switch checked={sms} onCheckedChange={setSms} label="SMS" disabled />
        </FormField>
        <FormField label="Marketing" htmlFor="opt-marketing">
          <Switch checked={marketing} onCheckedChange={setMarketing} label="Marketing" />
        </FormField>
      </div>
    );
  },
};
