#!/usr/bin/env tsx
/**
 * Notification catalog status generator.
 *
 * Reproducible, CI-friendly view of notification coverage. Crosses the
 * declarative catalog in packages/shared-types/src/notification-catalog.ts
 * against the actual emitters (services/*.ts), listeners (events/listeners/
 * *.ts), and email templates (services/email/templates/*.tsx).
 *
 * Output: docs/notifications/catalog-status.md
 *
 * The generator ALWAYS exits 0 — its only job is to write the report.
 * The CI gate that fails the build on drift lives in
 * scripts/check-notification-catalog-integrity.ts.
 *
 * Run: `npm run notifications:status` (or `npx tsx scripts/generate-
 * notification-catalog-status.ts`).
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildRows,
  computeViolations,
  NO_EMITTER_OR_LISTENER_WAIVER,
  REPO_ROOT,
  scanAll,
  type CatalogRow,
  type CatalogViolation,
} from "./lib/notification-catalog-scan";

const REPORT_PATH = path.join(REPO_ROOT, "docs/notifications/catalog-status.md");

function gitCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function gitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function formatLocations(locs: { file: string; line: number }[]): string {
  if (locs.length === 0) return "—";
  // Show at most two locations per cell so the table stays scannable; the
  // full list ends up in the Gaps section if needed.
  return locs
    .slice(0, 2)
    .map(({ file, line }) => `\`${file}:${line}\``)
    .join("<br>")
    .concat(locs.length > 2 ? `<br>…+${locs.length - 2} more` : "");
}

function renderRow(row: CatalogRow): string {
  const { def } = row;
  const cells = [
    `\`${def.key}\``,
    def.category,
    `\`${def.triggerDomainEvent}\``,
    row.emitters.length > 0 ? formatLocations(row.emitters) : "**missing**",
    row.listeners.length > 0 ? formatLocations(row.listeners) : "**missing**",
    def.defaultChannels.includes("email")
      ? row.templateResolved
        ? `\`${def.templates.email}\``
        : `**missing** (\`${def.templates.email ?? "unset"}\`)`
      : "n/a",
    def.supportedChannels.join(", "),
    def.defaultChannels.join(", "),
    def.userOptOutAllowed ? "yes" : "no",
  ];
  return `| ${cells.join(" | ")} |`;
}

function renderGaps(rows: CatalogRow[], violations: CatalogViolation[]): string {
  const gapRows = rows.filter((r) => r.hasGap);
  const lines: string[] = [];

  if (gapRows.length === 0 && violations.length === 0) {
    lines.push("No gaps detected — every catalog entry has an emitter, a listener, and a resolved email template.");
    return lines.join("\n");
  }

  if (gapRows.length > 0) {
    lines.push("### Coverage gaps");
    lines.push("");
    lines.push("The following catalog entries are missing at least one of emitter, listener, or email template:");
    lines.push("");
    for (const row of gapRows) {
      const missing: string[] = [];
      if (row.emitters.length === 0) missing.push("emitter");
      if (row.listeners.length === 0) missing.push("listener");
      if (row.def.defaultChannels.includes("email") && !row.templateResolved) {
        missing.push("email template");
      }
      const waived = NO_EMITTER_OR_LISTENER_WAIVER.has(row.def.key)
        ? " _(CI-waived — see `NO_EMITTER_OR_LISTENER_WAIVER` in `scripts/lib/notification-catalog-scan.ts`)_"
        : "";
      lines.push(
        `- \`${row.def.key}\` → triggerDomainEvent \`${row.def.triggerDomainEvent}\` — missing: ${missing.join(", ")}${waived}`,
      );
    }
    lines.push("");
  }

  if (violations.length > 0) {
    lines.push("### CI integrity violations");
    lines.push("");
    lines.push("The following rows would fail `npm run notifications:check`:");
    lines.push("");
    for (const v of violations) {
      lines.push(`- \`${v.key}\` (${v.reason}): ${v.message}`);
    }
  }

  return lines.join("\n");
}

function main(): void {
  const scan = scanAll();
  const rows = buildRows(scan);
  const violations = computeViolations(scan);

  const totalEntries = rows.length;
  const withEmitter = rows.filter((r) => r.emitters.length > 0).length;
  const withListener = rows.filter((r) => r.listeners.length > 0).length;
  const withEmailTemplate = rows.filter((r) => r.templateResolved).length;
  const gapCount = rows.filter((r) => r.hasGap).length;

  const header = [
    "# Notification Catalog Status",
    "",
    "<!--",
    "  Auto-generated — DO NOT EDIT BY HAND.",
    "  Regenerate with: npm run notifications:status",
    "  Source:          packages/shared-types/src/notification-catalog.ts",
    "-->",
    "",
    `- **Generated at:** ${new Date().toISOString()}`,
    `- **Branch:**       \`${gitBranch()}\``,
    `- **Commit:**       \`${gitCommitSha()}\``,
    "",
    "## Summary",
    "",
    `- Total catalog entries: **${totalEntries}**`,
    `- With at least one emitter in \`apps/api/src/services\`: **${withEmitter}**`,
    `- With at least one listener in \`apps/api/src/events/listeners\`: **${withListener}**`,
    `- With a resolved email template: **${withEmailTemplate}**`,
    `- Entries with at least one gap: **${gapCount}**`,
    `- CI integrity violations: **${violations.length}**`,
    "",
    "## Truth table",
    "",
    "| Key | Category | Trigger event | Emitter? (file:line) | Listener? (file:line) | Email template? | Supported channels | Default channels | User opt-out |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(renderRow),
    "",
    "## Gaps",
    "",
    renderGaps(rows, violations),
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, header, "utf8");

  // Fire-and-forget stdout summary so CI logs don't need to open the file.
  process.stdout.write(
    `Wrote ${path.relative(REPO_ROOT, REPORT_PATH)} — ${totalEntries} entries, ${gapCount} with gaps, ${violations.length} CI violations.\n`,
  );
}

main();
