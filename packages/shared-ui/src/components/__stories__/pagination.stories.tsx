import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Pagination } from "../pagination";

const meta: Meta<typeof Pagination> = {
  title: "Core Components/Pagination",
  component: Pagination,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Page navigation with smart ellipsis collapse. Shows up to 7 page " +
          "numbers; beyond that, the rendering compresses with `…` markers. The " +
          "ARIA pattern follows the WAI-ARIA Authoring Practices: nav landmark, " +
          "current page marked `aria-current=\"page\"`, prev/next buttons " +
          "disabled at boundaries.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Pagination>;

export const SinglePage: Story = {
  render: () => {
    const [page, setPage] = useState(1);
    return <Pagination currentPage={page} totalPages={1} onPageChange={setPage} />;
  },
};

export const FewPages: Story = {
  render: () => {
    const [page, setPage] = useState(2);
    return <Pagination currentPage={page} totalPages={5} onPageChange={setPage} />;
  },
};

export const ManyPagesMiddle: Story = {
  name: "Many pages — middle range (collapsed both sides)",
  render: () => {
    const [page, setPage] = useState(15);
    return <Pagination currentPage={page} totalPages={42} onPageChange={setPage} />;
  },
};

export const ManyPagesStart: Story = {
  name: "Many pages — at start",
  render: () => {
    const [page, setPage] = useState(2);
    return <Pagination currentPage={page} totalPages={42} onPageChange={setPage} />;
  },
};

export const ManyPagesEnd: Story = {
  name: "Many pages — at end",
  render: () => {
    const [page, setPage] = useState(41);
    return <Pagination currentPage={page} totalPages={42} onPageChange={setPage} />;
  },
};

export const EnglishLocale: Story = {
  args: {
    currentPage: 7,
    totalPages: 42,
    onPageChange: () => {},
    labels: {
      previous: "Previous",
      next: "Next",
      navigation: "Pagination",
      page: (n) => `Page ${n}`,
    },
  },
};

export const Showcase: Story = {
  name: "Showcase: live wiring",
  render: () => {
    const TOTAL = 42;
    const [page, setPage] = useState(7);
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-border bg-card p-4 text-sm text-muted-foreground">
          Affichage de la page <strong className="text-foreground">{page}</strong> sur {TOTAL}
        </div>
        <Pagination currentPage={page} totalPages={TOTAL} onPageChange={setPage} />
      </div>
    );
  },
};
