#!/usr/bin/env tsx
/**
 * Export the Fastify Swagger document to docs-v2/30-api/openapi/.
 *
 * Run from the repo root: `npm run docs:openapi`
 * Run --check: `npm run docs:openapi:check` (CI freshness guard).
 *
 * Outputs:
 *   - docs-v2/30-api/openapi/openapi.json (canonical artefact)
 *   - docs-v2/30-api/openapi/openapi.yaml (human-friendly mirror)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "@/app";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "docs-v2", "30-api", "openapi");
const JSON_PATH = resolve(OUT_DIR, "openapi.json");
const YAML_PATH = resolve(OUT_DIR, "openapi.yaml");

const argv = process.argv.slice(2);
const CHECK_MODE = argv.includes("--check");

async function main() {
  process.env.LOG_LEVEL ??= "silent";

  const app = await buildApp();
  await app.ready();

  const spec = app.swagger();
  await app.close();

  const json = `${JSON.stringify(spec, null, 2)}\n`;
  const yaml = renderYaml(spec);

  if (CHECK_MODE) {
    const { readFile } = await import("node:fs/promises");
    const drifted: string[] = [];
    for (const [path, want] of [
      [JSON_PATH, json],
      [YAML_PATH, yaml],
    ] as const) {
      let have = "";
      try {
        have = await readFile(path, "utf8");
      } catch {
        drifted.push(`${path} (missing)`);
        continue;
      }
      if (have !== want) drifted.push(path);
    }
    if (drifted.length > 0) {
      console.error("OpenAPI artefact is stale. Run: npx tsx scripts/export-openapi.ts");
      for (const p of drifted) console.error(`  drift: ${p}`);
      process.exit(2);
    }
    console.log("OpenAPI artefact in sync with Fastify spec.");
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(JSON_PATH, json, "utf8");
  await writeFile(YAML_PATH, yaml, "utf8");
  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${YAML_PATH}`);
}

/**
 * Minimal YAML serializer — flat objects, arrays of scalars/objects,
 * strings/numbers/booleans/null. Sufficient for the OpenAPI spec
 * shape. Avoids adding `js-yaml` as a build-time dependency.
 */
function renderYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quoteYamlString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((v) => {
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
          return `${pad}- ${renderYaml(v, indent + 1).trimStart()}`;
        }
        const inner = renderYaml(v, indent + 1);
        const lines = inner.split("\n");
        return `${pad}- ${lines[0]?.trimStart() ?? ""}\n${lines.slice(1).join("\n")}`.replace(/\n$/, "");
      })
      .join("\n");
  }

  // object
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      if (v === null || typeof v !== "object") {
        return `${pad}${escapeKey(k)}: ${renderYaml(v, indent + 1)}`;
      }
      if (Array.isArray(v) && v.length === 0) return `${pad}${escapeKey(k)}: []`;
      if (!Array.isArray(v) && Object.keys(v as object).length === 0) {
        return `${pad}${escapeKey(k)}: {}`;
      }
      return `${pad}${escapeKey(k)}:\n${renderYaml(v, indent + 1)}`;
    })
    .join("\n") + "\n";
}

function escapeKey(k: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) return k;
  return JSON.stringify(k);
}

function quoteYamlString(s: string): string {
  if (s === "") return '""';
  // Always quote to avoid YAML's many implicit-typing footguns
  // (yes/no/on/off/numbers/dates/etc.).
  return JSON.stringify(s);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
