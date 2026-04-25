import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ThemeToggle } from "../theme-toggle";

const meta: Meta<typeof ThemeToggle> = {
  title: "Core Components/ThemeToggle",
  component: ThemeToggle,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Three-way theme picker: light / dark / system. Framework-agnostic — " +
          "works with any state owner (Next.js `next-themes`, a Zustand store, " +
          "raw React state). The `system` option respects the OS-level " +
          "`prefers-color-scheme` media query.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof ThemeToggle>;

export const Default: Story = {
  render: () => {
    const [theme, setTheme] = useState<string | undefined>("system");
    return (
      <div className="flex flex-col items-center gap-3">
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <p className="text-xs text-muted-foreground" role="status">
          Thème actif : <code>{theme ?? "non défini"}</code>
        </p>
      </div>
    );
  },
};

export const LightActive: Story = {
  render: () => {
    const [theme, setTheme] = useState<string | undefined>("light");
    return <ThemeToggle theme={theme} setTheme={setTheme} />;
  },
};

export const DarkActive: Story = {
  render: () => {
    const [theme, setTheme] = useState<string | undefined>("dark");
    return <ThemeToggle theme={theme} setTheme={setTheme} />;
  },
};

export const EnglishLabels: Story = {
  args: {
    theme: "system",
    setTheme: () => {},
    labels: {
      group: "Theme",
      light: "Light",
      dark: "Dark",
      system: "System",
    },
  },
};

export const WolofLabels: Story = {
  args: {
    theme: "system",
    setTheme: () => {},
    labels: {
      group: "Tema bi",
      light: "Leeral",
      dark: "Lëndëm",
      system: "Sistemu jot",
    },
  },
};
