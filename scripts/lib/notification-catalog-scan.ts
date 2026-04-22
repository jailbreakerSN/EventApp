/**
 * Notification catalog scanning helpers.
 *
 * Shared between:
 *   - scripts/generate-notification-catalog-status.ts (the Markdown report
 *     generator — produces docs/notifications/catalog-status.md).
 *   - scripts/check-notification-catalog-integrity.ts (the CI guard that
 *     exits non-zero when the catalog drifts from the code).
 *
 * Intentionally dependency-light: uses only Node's built-in fs / path /
 * child_process, plus the compiled `@teranga/shared-types` entry for the
 * catalog itself. Scanning is regex-based because the cost of a full
 * TypeScript AST parse far exceeds the value for a single-pattern extract
 * (eventBus.emit / eventBus.on call sites with string-literal first args).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  NOTIFICATION_CATALOG,
  type NotificationChannel,
  type NotificationDefinition,
} from "@teranga/shared-types";

// ─── Paths ─────────────────────────────────────────────────────────────────

/** Repository root. Derived from this file's location so the script works
 *  regardless of cwd (tsx may be invoked from any directory). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const SERVICES_DIR = path.join(REPO_ROOT, "apps/api/src/services");
export const LISTENERS_DIR = path.join(REPO_ROOT, "apps/api/src/events/listeners");
export const EMAIL_TEMPLATES_DIR = path.join(
  REPO_ROOT,
  "apps/api/src/services/email/templates",
);
/**
 * The dispatcher adapter owns the canonical PascalCase template-id ↔ builder
 * registry. Several catalog ids (e.g. `NewsletterWelcome`) are registered
 * here but don't map 1:1 to a filename (the file is `welcome-newsletter.tsx`
 * and the export is `buildWelcomeEmail`). Reading the adapter's keys too
 * mirrors what the runtime resolves at dispatch time.
 */
export const EMAIL_DISPATCHER_ADAPTER = path.join(
  REPO_ROOT,
  "apps/api/src/services/email/dispatcher-adapter.ts",
);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CodeLocation {
  /** Path relative to REPO_ROOT — stable across machines, friendly in reports. */
  file: string;
  line: number;
}

export interface ScanResult {
  /** Domain event name → list of emitter call sites (services only). */
  emitters: Map<string, CodeLocation[]>;
  /** Domain event name → list of listener call sites. */
  listeners: Map<string, CodeLocation[]>;
  /**
   * PascalCase template ids available in the email templates folder — derived
   * from both filenames (kebab-case → PascalCase) and from the `buildXxxEmail`
   * exports in `index.ts`. Either source is sufficient.
   */
  emailTemplateIds: Set<string>;
  /** File paths of the .tsx templates we saw (for pretty-printing). */
  emailTemplateFiles: Map<string, string>;
}

export interface CatalogViolation {
  key: string;
  /** Short machine-readable reason code (useful for CI log parsing). */
  reason:
    | "missing_email_template"
    | "template_id_not_found"
    | "no_emitter_or_listener"
    | "default_channel_not_supported";
  message: string;
}

/**
 * Catalog keys whose `triggerDomainEvent` is wired up outside the
 * eventBus — the check can't see them, but they're legitimately delivered.
 * The report still surfaces every waived entry in the "Coverage gaps"
 * section so they stay visible; only the CI exit code is waived.
 *
 *   • `auth.email_verification` / `auth.password_reset`
 *     Triggered via route handlers in apps/api/src/routes/auth-email.routes.ts
 *     that call authEmailService.send*Email(...) directly. The route-based
 *     design deliberately sidesteps eventBus to keep the verification/reset
 *     path synchronous (user clicks "resend", the request blocks until the
 *     mail is queued, the UI reflects success/failure).
 *
 *   • `event.reminder`
 *     Emitted by a scheduled Firebase Function in apps/functions/src/
 *     triggers/reminder.triggers.ts, which writes notification documents
 *     directly via the Admin SDK. Lives in Cloud Functions (not the API)
 *     because only Functions get the managed Cloud Scheduler hook.
 *
 * New entries may only be added with a clear owner + follow-up reference.
 */
export const NO_EMITTER_OR_LISTENER_WAIVER: ReadonlySet<string> = new Set([
  "auth.email_verification",
  "auth.password_reset",
  "event.reminder",
]);

// ─── File walker ───────────────────────────────────────────────────────────

/**
 * Walk a directory recursively and yield every `.ts`/`.tsx` file outside
 * `__tests__` and `node_modules`. Test-only emitters would muddy the report
 * because they're synthetic calls that never run in prod.
 */
export function walkTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...walkTypeScriptFiles(full));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  }
  return out;
}

// ─── Regex scan primitives ─────────────────────────────────────────────────

// Matches  eventBus.emit("event.name", ...)  or  eventBus.on("event.name", ...)
// Captures the event name. The `g` flag is mandatory so we can iterate every
// occurrence; the `m` flag lets `^` anchor per-line if we ever tighten it.
const EMIT_REGEX = /eventBus\.emit\s*\(\s*["']([^"']+)["']/g;
const ON_REGEX = /eventBus\.on\s*\(\s*["']([^"']+)["']/g;

/**
 * Secondary listener pattern used in notification-dispatcher.listener.ts:
 * the same handler body is registered for several related events via a
 * `for (const { event } of [...]) eventBus.on(event, ...)` loop. The
 * loop items look like `{ event: "member.role_changed" as const, ... }`,
 * so extract the string-literal values from those object shorthand entries
 * to avoid false "missing listener" reports.
 */
const ON_LOOP_ITEM_REGEX = /\{\s*event\s*:\s*["']([^"']+)["']/g;

/**
 * Scan a single file for all matches of `pattern` and return the captured
 * name + the 1-based line number of each match. Line numbers come from a
 * cheap `\n` prefix scan of the raw source — no AST, good enough for a
 * fixed single-token pattern.
 */
function extractCalls(
  filePath: string,
  pattern: RegExp,
): Array<{ name: string; line: number }> {
  const source = fs.readFileSync(filePath, "utf8");
  const found: Array<{ name: string; line: number }> = [];
  // Reset lastIndex because the regex has the `g` flag and is reused across
  // files in the caller.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const prefix = source.slice(0, match.index);
    const line = prefix.split("\n").length;
    found.push({ name: match[1]!, line });
  }
  return found;
}

// ─── Public scan helpers ───────────────────────────────────────────────────

/** Scan all non-test service files for `eventBus.emit("<name>", ...)`. */
export function scanEmitters(): Map<string, CodeLocation[]> {
  const out = new Map<string, CodeLocation[]>();
  for (const file of walkTypeScriptFiles(SERVICES_DIR)) {
    const rel = path.relative(REPO_ROOT, file);
    for (const { name, line } of extractCalls(file, EMIT_REGEX)) {
      const list = out.get(name) ?? [];
      list.push({ file: rel, line });
      out.set(name, list);
    }
  }
  return out;
}

/**
 * Scan listener files for `eventBus.on("<name>", ...)` plus the
 * `{ event: "<name>" as const }` loop items consumed by dynamic
 * registrations (see ON_LOOP_ITEM_REGEX comment).
 */
export function scanListeners(): Map<string, CodeLocation[]> {
  const out = new Map<string, CodeLocation[]>();
  for (const file of walkTypeScriptFiles(LISTENERS_DIR)) {
    const rel = path.relative(REPO_ROOT, file);
    for (const { name, line } of extractCalls(file, ON_REGEX)) {
      const list = out.get(name) ?? [];
      list.push({ file: rel, line });
      out.set(name, list);
    }
    for (const { name, line } of extractCalls(file, ON_LOOP_ITEM_REGEX)) {
      const list = out.get(name) ?? [];
      list.push({ file: rel, line });
      out.set(name, list);
    }
  }
  return out;
}

// ─── Email template discovery ──────────────────────────────────────────────

/** Convert `email-verification` → `EmailVerification`. */
function kebabToPascal(name: string): string {
  return name
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Build the set of available email-template ids by scanning the templates
 * folder. Both filename-derived and `index.ts`-derived ids are returned;
 * either is sufficient proof the template exists.
 */
export function scanEmailTemplates(): {
  ids: Set<string>;
  files: Map<string, string>;
} {
  const ids = new Set<string>();
  const files = new Map<string, string>();

  if (!fs.existsSync(EMAIL_TEMPLATES_DIR)) {
    return { ids, files };
  }

  for (const entry of fs.readdirSync(EMAIL_TEMPLATES_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tsx")) continue;
    const base = entry.name.slice(0, -".tsx".length);
    const pascal = kebabToPascal(base);
    ids.add(pascal);
    files.set(pascal, path.relative(REPO_ROOT, path.join(EMAIL_TEMPLATES_DIR, entry.name)));
  }

  const indexFile = path.join(EMAIL_TEMPLATES_DIR, "index.ts");
  if (fs.existsSync(indexFile)) {
    const source = fs.readFileSync(indexFile, "utf8");
    // Matches: `export { buildFooEmail }`  → captures `Foo`.
    // The i18n helpers and type re-exports don't follow the `build…Email`
    // convention, so they're naturally ignored.
    const regex = /export\s*\{\s*build([A-Za-z0-9]+?)Email\b/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      ids.add(match[1]!);
    }
  }

  // Dispatcher adapter declares the authoritative PascalCase template-id →
  // builder mapping. The catalog's `templates.email` must appear as a key
  // here at runtime for dispatch to succeed, so mirror those keys into the
  // available-ids set.
  if (fs.existsSync(EMAIL_DISPATCHER_ADAPTER)) {
    const source = fs.readFileSync(EMAIL_DISPATCHER_ADAPTER, "utf8");
    // Match the start of a builder entry, e.g.:
    //   NewsletterWelcome: {
    //     build: buildWelcomeEmail ...
    // The `build:` on the following non-empty line disambiguates from
    // unrelated PascalCase identifiers in the same file.
    const regex = /^\s*([A-Z][A-Za-z0-9]+)\s*:\s*\{\s*\n\s*build\s*:/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      ids.add(match[1]!);
    }
  }

  return { ids, files };
}

// ─── Aggregate ─────────────────────────────────────────────────────────────

export function scanAll(): ScanResult {
  const emitters = scanEmitters();
  const listeners = scanListeners();
  const { ids: emailTemplateIds, files: emailTemplateFiles } = scanEmailTemplates();
  return { emitters, listeners, emailTemplateIds, emailTemplateFiles };
}

// ─── Integrity checks (shared by the generator and the CI guard) ───────────

/**
 * Compute every integrity violation for the given scan result. The CI
 * guard (`check-notification-catalog-integrity.ts`) exits non-zero when
 * this returns a non-empty list; the report generator surfaces the same
 * list in its "Gaps" section.
 */
export function computeViolations(scan: ScanResult): CatalogViolation[] {
  const violations: CatalogViolation[] = [];

  for (const def of NOTIFICATION_CATALOG) {
    // Rule 1 — defaultChannels ⊂ supportedChannels. Zod already enforces
    // this at import time via assertCatalogIntegrity(), but CI should shout
    // if the rule is ever loosened upstream.
    const supported = new Set<NotificationChannel>(def.supportedChannels);
    for (const ch of def.defaultChannels) {
      if (!supported.has(ch)) {
        violations.push({
          key: def.key,
          reason: "default_channel_not_supported",
          message: `default channel "${ch}" is not listed in supportedChannels`,
        });
      }
    }

    // Rule 2 — if email is a default channel, we must have a template id
    // AND that id must resolve to a real file (either filename-derived or
    // exported from templates/index.ts).
    if (def.defaultChannels.includes("email")) {
      const templateId = def.templates.email;
      if (!templateId) {
        violations.push({
          key: def.key,
          reason: "missing_email_template",
          message: `defaultChannels includes "email" but templates.email is unset`,
        });
      } else if (!scan.emailTemplateIds.has(templateId)) {
        violations.push({
          key: def.key,
          reason: "template_id_not_found",
          message: `templates.email="${templateId}" does not resolve to any file under apps/api/src/services/email/templates/`,
        });
      }
    }

    // Rule 3 — the trigger domain event must be observed somewhere (an
    // emitter or a listener). Catalog entries that are pure design
    // artifacts — no one emits them and no one listens — are dead code.
    // Exception: keys in NO_EMITTER_OR_LISTENER_WAIVER are known to be
    // wired up outside eventBus (routes, Cloud Functions schedulers) or
    // are tracked follow-ups in a subsequent phase. The report still
    // surfaces them as gaps so they stay visible — only the CI exit code
    // is waived.
    const event = def.triggerDomainEvent;
    const hasEmitter = (scan.emitters.get(event)?.length ?? 0) > 0;
    const hasListener = (scan.listeners.get(event)?.length ?? 0) > 0;
    if (!hasEmitter && !hasListener && !NO_EMITTER_OR_LISTENER_WAIVER.has(def.key)) {
      violations.push({
        key: def.key,
        reason: "no_emitter_or_listener",
        message: `triggerDomainEvent "${event}" has no eventBus.emit(...) caller in services AND no eventBus.on(...) listener`,
      });
    }
  }

  return violations;
}

// ─── Gap metadata (used only by the Markdown generator) ────────────────────

export interface CatalogRow {
  def: NotificationDefinition;
  emitters: CodeLocation[];
  listeners: CodeLocation[];
  templateResolved: boolean;
  /** A gap is a missing ingredient — emitter, listener, or email template. */
  hasGap: boolean;
}

export function buildRows(scan: ScanResult): CatalogRow[] {
  return NOTIFICATION_CATALOG.map((def) => {
    const emitters = scan.emitters.get(def.triggerDomainEvent) ?? [];
    const listeners = scan.listeners.get(def.triggerDomainEvent) ?? [];
    const templateId = def.templates.email;
    const templateResolved =
      def.defaultChannels.includes("email") && typeof templateId === "string"
        ? scan.emailTemplateIds.has(templateId)
        : !def.defaultChannels.includes("email");
    const hasGap =
      emitters.length === 0 ||
      listeners.length === 0 ||
      (def.defaultChannels.includes("email") && !templateResolved);
    return { def, emitters, listeners, templateResolved, hasGap };
  });
}
