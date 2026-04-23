/**
 * Storybook stories for the delivery-dashboard chart primitives.
 *
 * Note: The repo's Storybook config (`packages/shared-ui/.storybook/main.ts`)
 * only globs `packages/shared-ui/src/**` — these stories are co-located
 * with the feature for discoverability and so the visual-regression test
 * harness can opt into them once a backoffice-level Storybook is wired.
 * Until then they still run as Vitest-friendly fixtures; a Storybook
 * migration can pick them up without moving files.
 */

import type { Meta, StoryObj } from "@storybook/react";
import {
  DeliveryFunnelChart,
  DeliveryTimeseriesChart,
  PerChannelBarChart,
  SuppressionDonut,
  type ChartLabelMap,
  type FunnelStageLabels,
} from "./delivery-charts";
import type {
  AdminDeliveryDashboardBucket,
  AdminDeliveryDashboardPerChannel,
  AdminDeliveryDashboardTotals,
} from "@/lib/api-client";

// ─── Static labels ───────────────────────────────────────────────────────
// French labels — the chart primitives are locale-agnostic, so stories use
// a frozen French map to match the default admin-surface experience.

const CHART_LABELS: ChartLabelMap = {
  sent: "Envoyés",
  delivered: "Livrés",
  opened: "Ouverts",
  clicked: "Cliqués",
  pushDisplayed: "Push affichés",
  pushClicked: "Push cliqués",
  suppressed: "Supprimés",
  admin_disabled: "Désactivée admin",
  user_opted_out: "Désabonnement utilisateur",
  on_suppression_list: "Liste de suppression",
  no_recipient: "Pas de destinataire",
  rate_limited: "Rate-limit",
  deduplicated: "Dédupliqués",
  bounced: "Rebond",
  complained: "Plainte",
  successRate: "Taux de succès",
};

const FUNNEL_STAGE_LABELS: FunnelStageLabels = {
  sent: "Envoyés",
  delivered: "Livrés",
  opened: "Ouverts",
  clicked: "Cliqués",
  displayed: "Affichés",
};

// ─── Static fixtures ─────────────────────────────────────────────────────
// Deterministic so the a11y + visual-regression snapshots stay stable.

const TIMESERIES_FIXTURE: AdminDeliveryDashboardBucket[] = [
  {
    bucket: "2026-04-17T00:00:00.000Z",
    sent: 18,
    delivered: 16,
    opened: 10,
    clicked: 3,
    pushDisplayed: 2,
    pushClicked: 0,
    suppressed: 2,
  },
  {
    bucket: "2026-04-18T00:00:00.000Z",
    sent: 22,
    delivered: 21,
    opened: 14,
    clicked: 5,
    pushDisplayed: 3,
    pushClicked: 1,
    suppressed: 1,
  },
  {
    bucket: "2026-04-19T00:00:00.000Z",
    sent: 30,
    delivered: 28,
    opened: 19,
    clicked: 7,
    pushDisplayed: 5,
    pushClicked: 2,
    suppressed: 3,
  },
  {
    bucket: "2026-04-20T00:00:00.000Z",
    sent: 25,
    delivered: 24,
    opened: 14,
    clicked: 4,
    pushDisplayed: 4,
    pushClicked: 1,
    suppressed: 4,
  },
];

const PER_CHANNEL_FIXTURE: AdminDeliveryDashboardPerChannel[] = [
  { channel: "email", sent: 95, suppressed: 10, successRate: 0.89 },
  { channel: "in_app", sent: 14, suppressed: 0, successRate: 1 },
  { channel: "push", sent: 8, suppressed: 1, successRate: 0.87 },
];

const TOTALS_FIXTURE: AdminDeliveryDashboardTotals = {
  sent: 23,
  delivered: 51,
  opened: 32,
  clicked: 10,
  pushDisplayed: 14,
  pushClicked: 4,
  suppressed: {
    admin_disabled: 1,
    user_opted_out: 3,
    on_suppression_list: 2,
    no_recipient: 1,
    rate_limited: 0,
    deduplicated: 4,
    bounced: 2,
    complained: 1,
  },
};

// ─── Timeseries ──────────────────────────────────────────────────────────

const timeseriesMeta: Meta<typeof DeliveryTimeseriesChart> = {
  title: "Admin/Notifications/DeliveryTimeseriesChart",
  component: DeliveryTimeseriesChart,
  parameters: { a11y: { element: "#storybook-root" } },
};
export default timeseriesMeta;

export const TimeseriesDefault: StoryObj<typeof DeliveryTimeseriesChart> = {
  args: {
    data: TIMESERIES_FIXTURE,
    granularity: "day",
    title: "Volumes par jour",
    emptyLabel: "Aucune activité sur la fenêtre sélectionnée.",
    labels: CHART_LABELS,
  },
};

export const TimeseriesEmpty: StoryObj<typeof DeliveryTimeseriesChart> = {
  args: {
    data: [],
    granularity: "day",
    title: "Volumes par jour",
    emptyLabel: "Aucune activité sur la fenêtre sélectionnée.",
    labels: CHART_LABELS,
  },
};

// ─── Per-channel bar ─────────────────────────────────────────────────────

export const PerChannelDefault: StoryObj<typeof PerChannelBarChart> = {
  render: (args) => <PerChannelBarChart {...args} />,
  args: {
    data: PER_CHANNEL_FIXTURE,
    title: "Succès par canal",
    emptyLabel: "Aucun canal actif sur la fenêtre.",
    labels: CHART_LABELS,
  },
};

// ─── Suppression donut ───────────────────────────────────────────────────

export const SuppressionDefault: StoryObj<typeof SuppressionDonut> = {
  render: (args) => <SuppressionDonut {...args} />,
  args: {
    totals: TOTALS_FIXTURE.suppressed,
    title: "Motifs de suppression",
    emptyLabel: "Aucune suppression sur la fenêtre.",
    labels: CHART_LABELS,
  },
};

// ─── Funnel ──────────────────────────────────────────────────────────────

export const FunnelEmail: StoryObj<typeof DeliveryFunnelChart> = {
  render: (args) => <DeliveryFunnelChart {...args} />,
  args: {
    totals: TOTALS_FIXTURE,
    kind: "email",
    title: "Entonnoir e-mail",
    stageLabels: FUNNEL_STAGE_LABELS,
  },
};

export const FunnelPush: StoryObj<typeof DeliveryFunnelChart> = {
  render: (args) => <DeliveryFunnelChart {...args} />,
  args: {
    totals: TOTALS_FIXTURE,
    kind: "push",
    title: "Entonnoir push",
    stageLabels: FUNNEL_STAGE_LABELS,
  },
};
