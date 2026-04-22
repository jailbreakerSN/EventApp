#!/usr/bin/env tsx
/**
 * Seed-data coverage status generator.
 *
 * Reproducible, CI-friendly view of seed coverage. Crosses the canonical
 * Firestore collection list (apps/api/src/config/firebase.ts → COLLECTIONS)
 * against the reset list (scripts/seed/config.ts → RESETTABLE_COLLECTIONS)
 * and the actual seed writers (scripts/seed-*.ts + scripts/seed/*.ts).
 *
 * Output: docs/seed/coverage-status.md
 *
 * The generator ALWAYS exits 0 — its only job is to write the report.
 * The CI gate that fails the build on drift lives in
 * scripts/check-seed-coverage.ts.
 *
 * Run: `npm run seed:status` (or `npx tsx scripts/generate-seed-coverage-
 * status.ts`).
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  REPO_ROOT,
  computeCoverage,
  computeViolations,
  type SeedCoverageEntry,
} from "./lib/seed-coverage-scan";

const REPORT_PATH = path.join(REPO_ROOT, "docs/seed/coverage-status.md");

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

function formatWriters(files: string[]): string {
  if (files.length === 0) return "—";
  // Show at most two writers per cell so the table stays scannable; the
  // full list is rarely needed and ends up in git grep anyway.
  return files
    .slice(0, 2)
    .map((f) => `\`${f}\``)
    .join("<br>")
    .concat(files.length > 2 ? `<br>…+${files.length - 2} more` : "");
}

function renderRow(entry: SeedCoverageEntry): string {
  const constCell = entry.collectionConstKey
    ? `\`${entry.collectionConstKey}\``
    : "**(not in COLLECTIONS)**";
  const resetCell = entry.inResettableList ? "yes" : "**no**";
  const writersCell = formatWriters(entry.seedWriterFiles);
  const waiverCell = entry.hasAuditWaiver ? "yes" : "—";

  const cells = [
    `\`${entry.collectionName}\``,
    constCell,
    resetCell,
    writersCell,
    waiverCell,
  ];
  return `| ${cells.join(" | ")} |`;
}

function renderWaivers(entries: SeedCoverageEntry[]): string {
  const waived = entries.filter((e) => e.hasAuditWaiver);
  if (waived.length === 0) {
    return "_No waivers configured._";
  }
  const lines: string[] = [];
  lines.push(
    "The following collections are intentionally excluded from the seed-coverage requirement. Each needs a one-line rationale in `SEED_COVERAGE_WAIVER` (`scripts/lib/seed-coverage-scan.ts`).",
  );
  lines.push("");
  for (const entry of waived) {
    lines.push(`- \`${entry.collectionName}\` — ${entry.waiverReason ?? "(no reason recorded)"}`);
  }
  return lines.join("\n");
}

function renderViolations(violations: string[]): string {
  if (violations.length === 0) {
    return "No coverage gaps detected — every collection in `COLLECTIONS` is either in `RESETTABLE_COLLECTIONS` or waived.";
  }
  const lines: string[] = [];
  lines.push("The following gaps would fail `npm run seed:check`:");
  lines.push("");
  for (const v of violations) {
    lines.push(`- ${v}`);
  }
  return lines.join("\n");
}

function main(): void {
  const entries = computeCoverage();
  const violations = computeViolations(entries);

  const totalCollections = entries.filter((e) => e.collectionConstKey).length;
  const withWriter = entries.filter((e) => e.seedWriterFiles.length > 0).length;
  const inResetOnly = entries.filter(
    (e) => e.inResettableList && e.seedWriterFiles.length === 0 && !e.hasAuditWaiver,
  ).length;
  const waived = entries.filter((e) => e.hasAuditWaiver).length;

  const header = [
    "# Seed Data Coverage Status",
    "",
    "<!--",
    "  Auto-generated — DO NOT EDIT BY HAND.",
    "  Regenerate with: npm run seed:status",
    "  Sources:         apps/api/src/config/firebase.ts (COLLECTIONS)",
    "                   scripts/seed/config.ts          (RESETTABLE_COLLECTIONS)",
    "                   scripts/seed*.ts                (writer scan)",
    "-->",
    "",
    `- **Generated at:** ${new Date().toISOString()}`,
    `- **Branch:**       \`${gitBranch()}\``,
    `- **Commit:**       \`${gitCommitSha()}\``,
    "",
    "## Summary",
    "",
    `- Total collections in \`COLLECTIONS\`: **${totalCollections}**`,
    `- With at least one seed writer: **${withWriter}**`,
    `- In \`RESETTABLE_COLLECTIONS\` but no writer (reset-only): **${inResetOnly}**`,
    `- Waived (runtime-only / operator-only): **${waived}**`,
    `- CI integrity violations: **${violations.length}**`,
    "",
    "## Truth table",
    "",
    "Columns:",
    "- **Collection** — Firestore collection name.",
    "- **Const key** — Matching entry in `COLLECTIONS` (`apps/api/src/config/firebase.ts`).",
    "- **In reset list?** — Wiped by `npm run seed:reset`.",
    "- **Seed writer(s)** — Script(s) that write example data for this collection.",
    "- **Waived?** — Listed in `SEED_COVERAGE_WAIVER` (`scripts/lib/seed-coverage-scan.ts`).",
    "",
    "| Collection | Const key | In reset list? | Seed writer(s) | Waived? |",
    "| --- | --- | --- | --- | --- |",
    ...entries.map(renderRow),
    "",
    "## Waivers",
    "",
    renderWaivers(entries),
    "",
    "## CI integrity violations",
    "",
    renderViolations(violations),
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, header, "utf8");

  // Fire-and-forget stdout summary so CI logs don't need to open the file.
  process.stdout.write(
    `Wrote ${path.relative(REPO_ROOT, REPORT_PATH)} — ${totalCollections} collections, ${withWriter} with a seed writer, ${waived} waived, ${violations.length} CI violations.\n`,
  );
}

main();
