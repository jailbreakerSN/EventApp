import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LanguageSwitcher, DEFAULT_LOCALES } from "../language-switcher";

const meta: Meta<typeof LanguageSwitcher> = {
  title: "Core Components/LanguageSwitcher",
  component: LanguageSwitcher,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Sets the next-intl language cookie. Defaults to FR / EN / WO for the " +
          "Teranga francophone-first market. Pass `options` to override the locale " +
          "list, `cookieName` to integrate with non-next-intl frameworks.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof LanguageSwitcher>;

export const Default: Story = {
  render: () => {
    const [locale, setLocale] = useState("fr");
    return (
      <div className="flex flex-col items-center gap-3">
        <LanguageSwitcher
          options={DEFAULT_LOCALES}
          locale={locale}
          onChange={setLocale}
        />
        <p className="text-xs text-muted-foreground" role="status">
          Locale actuelle : <code>{locale}</code>
        </p>
      </div>
    );
  },
};

export const FrenchOnly: Story = {
  name: "Reduced options (FR only)",
  render: () => {
    const [locale, setLocale] = useState("fr");
    return (
      <LanguageSwitcher
        options={[{ value: "fr", label: "Français", shortCode: "FR" }]}
        locale={locale}
        onChange={setLocale}
      />
    );
  },
};

export const CustomLocales: Story = {
  name: "Custom set (FR + WO + Bambara hypothetical)",
  render: () => {
    const [locale, setLocale] = useState("fr");
    return (
      <LanguageSwitcher
        options={[
          { value: "fr", label: "Français", shortCode: "FR" },
          { value: "wo", label: "Wolof", shortCode: "WO" },
          { value: "bm", label: "Bamanankan", shortCode: "BM" },
        ]}
        locale={locale}
        onChange={setLocale}
        ariaLabel="Choisir la langue (étendu)"
      />
    );
  },
};
