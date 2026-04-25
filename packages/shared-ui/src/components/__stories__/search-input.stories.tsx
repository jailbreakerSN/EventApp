import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { SearchInput } from "../search-input";

const meta: Meta<typeof SearchInput> = {
  title: "Core Components/SearchInput",
  component: SearchInput,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Controlled search input with built-in clear (×) affordance. Renders " +
          "as `type=\"search\"` so browsers expose the native clear button on top " +
          "of ours; both are keyboard-accessible. Use with a debounced effect for " +
          "remote queries — see the live wiring example below.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SearchInput>;

export const Empty: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <SearchInput
        value={value}
        onChange={setValue}
        placeholder="Rechercher un événement..."
      />
    );
  },
};

export const WithValue: Story = {
  render: () => {
    const [value, setValue] = useState("dakar tech summit");
    return (
      <SearchInput
        value={value}
        onChange={setValue}
        placeholder="Rechercher un événement..."
      />
    );
  },
};

export const WithCustomPlaceholder: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <SearchInput
        value={value}
        onChange={setValue}
        placeholder="Filtrer par nom, email ou ID..."
      />
    );
  },
};

export const OnClearCallback: Story = {
  name: "Showcase: clear hook (onClear)",
  render: () => {
    const [value, setValue] = useState("modou ndiaye");
    const [cleared, setCleared] = useState(0);
    return (
      <div className="flex flex-col gap-2">
        <SearchInput
          value={value}
          onChange={setValue}
          onClear={() => setCleared((n) => n + 1)}
          placeholder="Tapez puis effacez pour incrémenter le compteur"
        />
        <p className="text-xs text-muted-foreground" role="status">
          Effacements détectés : {cleared}
        </p>
      </div>
    );
  },
};

export const DebouncedQuery: Story = {
  name: "Showcase: debounced remote query (200 ms)",
  render: () => {
    const [value, setValue] = useState("");
    const [debounced, setDebounced] = useState("");
    useEffect(() => {
      const t = setTimeout(() => setDebounced(value), 200);
      return () => clearTimeout(t);
    }, [value]);
    return (
      <div className="flex flex-col gap-2">
        <SearchInput
          value={value}
          onChange={setValue}
          placeholder="Tapez pour déclencher (200 ms de débounce)..."
        />
        <p className="text-xs text-muted-foreground" role="status">
          Requête effective : <code>{debounced || "—"}</code>
        </p>
      </div>
    );
  },
};
