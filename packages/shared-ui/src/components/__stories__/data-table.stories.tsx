import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Badge } from "../badge";
import { Button } from "../button";
import { DataTable } from "../data-table";

type Reg = {
  id: string;
  name: string;
  email: string;
  status: "confirmed" | "checked_in" | "cancelled";
  registeredAt: string;
} & Record<string, unknown>;

const data: Reg[] = [
  {
    id: "reg-001",
    name: "Moussa Diop",
    email: "moussa.diop@example.com",
    status: "checked_in",
    registeredAt: "2026-04-12",
  },
  {
    id: "reg-002",
    name: "Fatou Sall",
    email: "fatou.sall@example.com",
    status: "confirmed",
    registeredAt: "2026-04-15",
  },
  {
    id: "reg-003",
    name: "Aminata Fall",
    email: "aminata.fall@example.com",
    status: "confirmed",
    registeredAt: "2026-04-18",
  },
  {
    id: "reg-004",
    name: "Cheikh Sow",
    email: "cheikh.sow@example.com",
    status: "cancelled",
    registeredAt: "2026-03-29",
  },
  {
    id: "reg-005",
    name: "Ousmane Ndiaye",
    email: "ousmane.ndiaye@example.com",
    status: "confirmed",
    registeredAt: "2026-04-21",
  },
];

const statusBadge = (s: Reg["status"]) => {
  if (s === "checked_in") return <Badge variant="success">Présent</Badge>;
  if (s === "confirmed") return <Badge>Confirmé</Badge>;
  return <Badge variant="destructive">Annulé</Badge>;
};

const meta: Meta<typeof DataTable<Reg>> = {
  title: "Core Components/DataTable",
  component: DataTable<Reg>,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Polymorphic table with built-in loading skeletons, empty-state, " +
          "responsive card layout (`responsiveCards`), and row-click handler. " +
          "Cells can opt out of row navigation with `stopRowNavigation: true` " +
          "for action columns (kebabs, inline edits).",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof DataTable<Reg>>;

export const Default: Story = {
  render: () => (
    <DataTable<Reg>
      aria-label="Liste des inscriptions"
      columns={[
        { key: "name", header: "Nom", primary: true },
        { key: "email", header: "Email", hideOnMobile: true },
        {
          key: "status",
          header: "Statut",
          render: (r) => statusBadge(r.status),
        },
        { key: "registeredAt", header: "Inscrit le", hideOnMobile: true },
      ]}
      data={data}
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <DataTable<Reg>
      aria-label="Liste en chargement"
      columns={[
        { key: "name", header: "Nom" },
        { key: "email", header: "Email" },
        { key: "status", header: "Statut" },
      ]}
      data={[]}
      loading
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <DataTable<Reg>
      aria-label="Aucun résultat"
      columns={[
        { key: "name", header: "Nom" },
        { key: "email", header: "Email" },
      ]}
      data={[]}
      emptyMessage="Aucune inscription pour cet événement. Partagez le lien public pour démarrer."
    />
  ),
};

export const WithRowClick: Story = {
  name: "Row-clickable + action column",
  render: () => (
    <DataTable<Reg>
      aria-label="Liste cliquable"
      onRowClick={(r) => alert(`Ouvrir ${r.id}`)}
      columns={[
        { key: "name", header: "Nom", primary: true },
        { key: "email", header: "Email", hideOnMobile: true },
        {
          key: "status",
          header: "Statut",
          render: (r) => statusBadge(r.status),
        },
        {
          key: "actions",
          header: "Actions",
          stopRowNavigation: true,
          render: () => (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm">
                Renvoyer
              </Button>
              <Button variant="outline" size="sm">
                Annuler
              </Button>
            </div>
          ),
        },
      ]}
      data={data}
    />
  ),
};

export const ResponsiveCards: Story = {
  name: "Mobile: card layout",
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <DataTable<Reg>
      aria-label="Liste mobile"
      responsiveCards
      columns={[
        { key: "name", header: "Nom", primary: true },
        { key: "email", header: "Email" },
        {
          key: "status",
          header: "Statut",
          render: (r) => statusBadge(r.status),
        },
      ]}
      data={data}
    />
  ),
};

export const SortableColumns: Story = {
  name: "V2: sortable headers (controlled)",
  render: () => {
    const SortablePreview = (): JSX.Element => {
      const [sort, setSort] = React.useState<{ field: string; dir: "asc" | "desc" } | null>({
        field: "name",
        dir: "asc",
      });
      const toggle = (field: string): void => {
        setSort((current) => {
          if (current?.field !== field) return { field, dir: "asc" };
          if (current.dir === "asc") return { field, dir: "desc" };
          return null;
        });
      };
      const sorted = React.useMemo(() => {
        if (!sort) return data;
        const sign = sort.dir === "asc" ? 1 : -1;
        return [...data].sort((a, b) => {
          const av = (a as Record<string, unknown>)[sort.field] as string;
          const bv = (b as Record<string, unknown>)[sort.field] as string;
          return av > bv ? sign : av < bv ? -sign : 0;
        });
      }, [sort]);
      return (
        <DataTable<Reg>
          aria-label="Liste triable"
          sort={sort}
          onToggleSort={toggle}
          columns={[
            { key: "name", header: "Nom", primary: true, sortable: true },
            { key: "email", header: "Email", sortable: true },
            { key: "status", header: "Statut", render: (r) => statusBadge(r.status) },
          ]}
          data={sorted}
        />
      );
    };
    return <SortablePreview />;
  },
};

export const CompactDensity: Story = {
  name: "V2: compact density",
  render: () => (
    <DataTable<Reg>
      aria-label="Liste compacte"
      density="compact"
      columns={[
        { key: "name", header: "Nom", primary: true },
        { key: "email", header: "Email" },
        { key: "status", header: "Statut", render: (r) => statusBadge(r.status) },
      ]}
      data={data}
    />
  ),
};

export const StickyHeaderShowcase: Story = {
  name: "V2: sticky header on tall scroll",
  render: () => (
    <div style={{ maxHeight: 280, overflow: "auto" }}>
      <DataTable<Reg>
        aria-label="Sticky header"
        stickyHeader
        columns={[
          { key: "name", header: "Nom", primary: true, sortable: true },
          { key: "email", header: "Email" },
          { key: "status", header: "Statut", render: (r) => statusBadge(r.status) },
        ]}
        data={[...data, ...data, ...data, ...data, ...data]}
      />
    </div>
  ),
};
