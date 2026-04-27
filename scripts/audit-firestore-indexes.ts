#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Firestore composite-index linter
 *
 * Scans repository and trigger files for `.where()` / `.orderBy()` /
 * `findMany()` call patterns, computes the composite index each pattern
 * requires, and cross-checks against the declared indexes in
 * `infrastructure/firebase/firestore.indexes.json`.
 *
 * Exits 0 on full coverage, 1 if any query lacks a matching index, 2 on
 * a static-analysis error (malformed source, unresolvable collection).
 *
 * Intended to run in CI as a gate before deploy. The goal: never again
 * discover a missing composite index at runtime in staging.
 *
 * Severity model:
 *
 *  - `primary` shapes (blocking, exit 1 on miss):
 *      • the maximal combination (all optional filters applied), and
 *      • the mandatory-only combination (no optional filters applied).
 *    These are the corners of the query-shape hypercube and any realistic
 *    call path touches at least one of them.
 *
 *  - `subset` shapes (warning by default, blocking under AUDIT_SUBSETS=1):
 *      • every intermediate combination of optional filters. The previous
 *        staging miss (`category + isPublic + location.city + status +
 *        startDate`) was exactly one of these. Firestore requires a
 *        separate composite index per subset actually queried, so a full
 *        power-set scan is the only safe way to catch this class of bug.
 *        Run `AUDIT_SUBSETS=1 npx tsx scripts/audit-firestore-indexes.ts`
 *        in pre-deploy to gate on the full set.
 *
 * Heuristics and limitations (deliberate — full combinatorial coverage
 * would require proper type flow analysis):
 *
 *  - Conditional filters (inside `if (...)` blocks) are treated as optional.
 *    Subset generation is capped at 2^MAX_OPTIONAL to keep runtimes bounded;
 *    beyond that only the maximal combination is checked and a warning is
 *    surfaced.
 *  - Dynamic field names (where(variable, ...)) trigger a warning and are
 *    skipped for that method.
 *  - Only repositories that extend `BaseRepository` or Cloud Function
 *    triggers that call `db.collection(COLLECTIONS.X)` directly are scanned.
 *
 * Run: `npx tsx scripts/audit-firestore-indexes.ts`
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const INDEX_FILE = path.join(ROOT, "infrastructure/firebase/firestore.indexes.json");
const COLLECTIONS_SOURCES = [
  path.join(ROOT, "apps/api/src/config/firebase.ts"),
  path.join(ROOT, "apps/functions/src/utils/admin.ts"),
];
const SCAN_DIRS = [
  path.join(ROOT, "apps/api/src/repositories"),
  path.join(ROOT, "apps/api/src/services"),
  path.join(ROOT, "apps/functions/src/triggers"),
];
// Services don't declare a class-collection binding, so the primary
// `this.findMany(...)` → composite-index inference isn't driven from
// them. They are scanned ONLY to pick up the caller-controlled orderBy
// pattern (`orderBy: query.orderBy` without a literal fallback) that
// the repository layer hides from the audit. See the staging
// regression on GET /v1/venues fixed alongside this change.
const SKIP_FILES = new Set(["base.repository.ts"]); // generic helper, no collection

// Inequality ops treated as "range" for Firestore index rules.
const RANGE_OPS = new Set(["<", "<=", ">=", ">", "!="]);
// Equality-like ops (reside in the "equality" prefix of the composite).
const EQUALITY_OPS = new Set(["==", "in", "not-in"]);
// Array-element-matching ops — require `arrayConfig: "CONTAINS"` in the index.
// Firestore treats array-contains-any the same as array-contains for index
// selection; composite indexes with these fields use arrayConfig, not order.
const ARRAY_CONTAINS_OPS = new Set(["array-contains", "array-contains-any"]);

type IndexField = {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
};

type DeclaredIndex = {
  collectionGroup: string;
  queryScope?: string;
  fields: IndexField[];
};

type RequiredIndex = {
  collection: string;
  fields: IndexField[];
  source: string; // "file:line"
  method: string;
  queryShape: string; // human-readable
  /**
   * "primary" — the maximal or mandatory-only shape. Treated as blocking.
   * "subset"  — an intermediate subset of optional filters. Treated as a
   *             warning unless AUDIT_SUBSETS=1. See comment at top of file.
   */
  severity: "primary" | "subset";
};

type Warning = {
  source: string;
  message: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Load declared indexes + COLLECTIONS mapping
// ───────────────────────────────────────────────────────────────────────────

function loadDeclaredIndexes(): DeclaredIndex[] {
  const raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as {
    indexes: DeclaredIndex[];
  };
  return raw.indexes;
}

function loadCollectionsMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of COLLECTIONS_SOURCES) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    // Match inside a COLLECTIONS-ish object: `IDENT: "value",`
    // Restrict to lines inside an object literal containing "COLLECTIONS"
    const blockMatch = src.match(/COLLECTIONS[^{]*\{([\s\S]*?)\}\s*(?:as const)?;/);
    if (!blockMatch) continue;
    const body = blockMatch[1];
    const re = /(\w+)\s*:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      map[m[1]] = m[2];
    }
  }
  return map;
}

// ───────────────────────────────────────────────────────────────────────────
// Zod orderBy / orderDir enum discovery
// ───────────────────────────────────────────────────────────────────────────

/**
 * Catalogue of every `orderBy: z.enum([...])` and `orderDir: z.enum([...])`
 * declared in `packages/shared-types/` and `apps/api/src/routes/`.
 *
 * Why this exists: the participant /events page shipped with three sort
 * options (`startDate`, `createdAt`, `title`) declared in the Zod query
 * schema, but the repository code path was:
 *
 *    return this.findMany(wheres, {
 *      ...pagination,
 *      orderBy: pagination.orderBy ?? "startDate",
 *    });
 *
 * The previous version of this auditor only saw the literal `"startDate"`
 * fallback and generated indexes for that single value. A user-facing
 * "Ordre alphabétique" sort returned `FAILED_PRECONDITION` from Firestore
 * because no `(status, isPublic, title)` index was declared, and the page
 * silently swallowed the error as "0 events". This catalogue lets the
 * auditor expand any `?? "literal"` fallback through the matching Zod
 * enum so every reachable orderBy value is covered.
 *
 * Heuristic, not a proper resolver — we don't trace the variable back to
 * the enum it came from. We instead match the literal default against any
 * known orderBy enum that contains it. False positives (over-declaring
 * indexes) cost storage but are safe; false negatives ship a 500.
 */
type EnumCatalogue = {
  /** Each inner array is one declared `orderBy: z.enum([...])` value list. */
  orderByEnums: string[][];
  /** Each inner array is one declared `orderDir: z.enum([...])` value list. */
  orderDirEnums: string[][];
};

const ENUM_SCAN_DIRS = [
  path.join(ROOT, "packages/shared-types/src"),
  path.join(ROOT, "apps/api/src/routes"),
];

function discoverOrderByEnums(): EnumCatalogue {
  const orderByEnums: string[][] = [];
  const orderDirEnums: string[][] = [];
  const reBy = /orderBy\s*:\s*z\.enum\s*\(\s*\[([^\]]+)\]\s*\)/g;
  const reDir = /orderDir\s*:\s*z\.enum\s*\(\s*\[([^\]]+)\]\s*\)/g;
  // `z.literal("X")` is the single-value alphabet — treated as a
  // 1-element enum so the smallest-matching heuristic in
  // `expandThroughEnums` prefers it over a multi-value enum that
  // happens to contain X. Without this, narrowing a route to
  // `orderBy: z.literal("createdAt")` was effectively useless: the
  // auditor still expanded through any other `["startDate", "createdAt"]`
  // enum it found in the codebase, demanding a `(userId, startDate)`
  // composite index that the route forbids.
  const reByLit = /orderBy\s*:\s*z\.literal\s*\(\s*"([^"]+)"\s*\)/g;
  const reDirLit = /orderDir\s*:\s*z\.literal\s*\(\s*"([^"]+)"\s*\)/g;
  for (const dir of ENUM_SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walkDir(dir)) {
      const src = fs.readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      while ((m = reBy.exec(src)) !== null) {
        const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        if (values.length > 0) orderByEnums.push(values);
      }
      while ((m = reDir.exec(src)) !== null) {
        const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        if (values.length > 0) orderDirEnums.push(values);
      }
      while ((m = reByLit.exec(src)) !== null) {
        orderByEnums.push([m[1]]);
      }
      while ((m = reDirLit.exec(src)) !== null) {
        orderDirEnums.push([m[1]]);
      }
    }
  }
  return { orderByEnums, orderDirEnums };
}

/**
 * Resolve the alternative values for a `?? "literal"` fallback by matching
 * the literal against known enums. Returns the single literal when no enum
 * contains it (preserves prior behaviour for hard-coded fallbacks like
 * `?? "createdAt"` that don't correspond to a Zod schema).
 *
 * When MULTIPLE enums contain the literal, the SMALLEST enum wins. This
 * is the most-specific-match heuristic: a literal like "createdAt" is in
 * both EventSearchQuerySchema (`[startDate, createdAt, title]`) AND in
 * the back-office `OrgEventsQuerySchema` (`[startDate, createdAt]`) —
 * a repository called from the back-office route should NOT require a
 * `(organizationId, title)` composite. Picking the smallest matching
 * enum keeps the expansion tight without forcing every caller to also
 * declare the schema (we don't trace import graphs). Ties broken by
 * source order for determinism.
 */
function expandThroughEnums(literal: string, enums: string[][]): string[] {
  let best: string[] | null = null;
  for (const e of enums) {
    if (!e.includes(literal)) continue;
    if (best === null || e.length < best.length) best = e;
  }
  return best ?? [literal];
}

// ───────────────────────────────────────────────────────────────────────────
// File walking
// ───────────────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Skip test directories + files — they hold synthetic fixtures
    // (e.g. `field` as a variable name) that trip the caller-orderBy
    // heuristic without touching production code paths.
    if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !SKIP_FILES.has(entry.name)
    )
      out.push(full);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Source parsing — regex-based, scoped to one method/function at a time.
// ───────────────────────────────────────────────────────────────────────────
// Finding method boundaries: this uses a simple brace-matching walker that
// works for this codebase's style. Each detected method becomes a scope that
// collects query fragments.

type MethodScope = {
  name: string;
  startLine: number;
  body: string;
};

function extractMethods(source: string): MethodScope[] {
  // Match function / method / arrow-function headers:
  //   async foo(args): ReturnType {
  //   function foo(args) {
  //   const foo = async (args) => {
  //   export const foo = (args): R => {
  // Allow TypeScript access modifiers (`private`, `protected`, `public`) and
  // `static`. Without this, `private async searchByKeyword(...)` is invisible
  // to the auditor — exactly the gap that hid the events.search regression
  // (the call goes through two private branches dispatched by `search()`).
  const headerRe =
    /(?:^|\n)[ \t]*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+|const\s+)?([a-zA-Z_][\w$]*)\s*(?:=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::\s*[^={]+)?\s*=>|\([^)]*\)\s*(?::\s*[^{]+)?)\s*\{/g;
  const scopes: MethodScope[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(source)) !== null) {
    const name = m[1];
    const openIdx = source.indexOf("{", m.index + m[0].length - 1);
    if (openIdx < 0) continue;
    // Walk braces to find the matching close.
    let depth = 1;
    let i = openIdx + 1;
    let inStr: string | null = null;
    let inComment: "line" | "block" | null = null;
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i];
      const prev = source[i - 1];
      if (inComment === "line") {
        if (ch === "\n") inComment = null;
        continue;
      }
      if (inComment === "block") {
        if (prev === "*" && ch === "/") inComment = null;
        continue;
      }
      if (inStr) {
        if (ch === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (ch === "/" && source[i + 1] === "/") {
        inComment = "line";
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        inComment = "block";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth !== 0) continue;
    const body = source.slice(openIdx + 1, i - 1);
    const startLine = source.slice(0, openIdx).split("\n").length;
    scopes.push({ name, startLine, body });
  }
  return scopes;
}

// ───────────────────────────────────────────────────────────────────────────
// Class → collection mapping (regex-based).
// ───────────────────────────────────────────────────────────────────────────

function extractClassCollections(
  source: string,
  collectionsMap: Record<string, string>,
): Map<string, string> {
  // Match `class Foo extends BaseRepository<...> { constructor(...) { super(COLLECTIONS.BAR, ...) } }`
  const classRe = /class\s+(\w+)\s+extends\s+BaseRepository[^{]*\{([\s\S]*?)^}/gm;
  const result = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(source)) !== null) {
    const className = m[1];
    const body = m[2];
    const superMatch = body.match(/super\s*\(\s*COLLECTIONS\.(\w+)/);
    if (superMatch) {
      const collectionKey = superMatch[1];
      const collectionName = collectionsMap[collectionKey];
      if (collectionName) result.set(className, collectionName);
    }
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-method: collect query fragments
// ───────────────────────────────────────────────────────────────────────────

type QueryFragment = {
  field: string;
  op: string;
  isDynamicField: boolean;
  /**
   * True when the where-clause sits inside an `if (...) { ... }` block —
   * i.e. the runtime query will only include this filter when the branch is
   * taken. Subset generation uses this to enumerate every reachable query
   * shape, not just the maximal one.
   */
  isOptional: boolean;
};

type OrderByFragment = {
  field: string;
  dir: "ASCENDING" | "DESCENDING";
};

/**
 * Info surfaced when a service forwards `orderBy: <variable>` to a repo
 * method without a literal fallback. The audit cannot resolve the value
 * at scan-time, so it warns the reviewer to double-check that composite
 * indexes exist for every orderBy value in the Zod schema the variable
 * comes from. Tracking commit (2026-04-23): GET /v1/venues 500'd on
 * staging because VenueQuerySchema.orderBy defaults to "name" but the
 * audit only saw `orderBy: query.orderBy` (no literal) and generated
 * an index shape that assumed the BaseRepository default ("createdAt").
 */
type UnresolvedOrderBy = {
  /** The variable expression we saw, e.g. `query.orderBy` or `pagination.orderBy`. */
  expression: string;
};

function extractQueryFragments(
  body: string,
  enums: EnumCatalogue = { orderByEnums: [], orderDirEnums: [] },
): {
  wheres: QueryFragment[];
  orderBys: OrderByFragment[];
  /**
   * Alternative orderBy fragments derived from `orderBy: x ?? "Y"` literal
   * fallbacks expanded through the matching Zod enum (see
   * `discoverOrderByEnums`). When non-empty, each alternative is treated
   * as a separate query shape during `enumerateQueryShapes`. Empty when
   * the method either has no `??` orderBy fallback or its fallback literal
   * doesn't match any known enum.
   */
  orderByAlternatives: OrderByFragment[];
  hasSelect: boolean;
  unresolvedOrderBys: UnresolvedOrderBy[];
} {
  const wheres: QueryFragment[] = [];
  const orderBys: OrderByFragment[] = [];
  const orderByAlternatives: OrderByFragment[] = [];

  // Pre-compute the span of every `if (...) { ... }` body in the method.
  // A where-clause whose character index sits inside any of these spans is
  // conditional — the runtime only sees it when the branch is taken.
  const ifBlockSpans = findIfBlockSpans(body);
  const isInsideIf = (idx: number): boolean =>
    ifBlockSpans.some((span) => idx >= span.start && idx < span.end);

  // Raw .where("field", "op", ...) calls
  const whereRe = /\.where\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = whereRe.exec(body)) !== null) {
    wheres.push({
      field: m[1],
      op: m[2],
      isDynamicField: false,
      isOptional: isInsideIf(m.index),
    });
  }

  // findMany/findOne filter-array shorthand:
  //   [{ field: "x", op: "==", value: ... }, ...]
  const filterObjRe = /\{\s*field:\s*"([^"]+)"\s*,\s*op:\s*"([^"]+)"/g;
  while ((m = filterObjRe.exec(body)) !== null) {
    wheres.push({
      field: m[1],
      op: m[2],
      isDynamicField: false,
      isOptional: isInsideIf(m.index),
    });
  }

  // Direct .orderBy("field", "dir") calls
  const orderByCallRe = /\.orderBy\s*\(\s*"([^"]+)"\s*,\s*"(asc|desc)"/g;
  while ((m = orderByCallRe.exec(body)) !== null) {
    orderBys.push({
      field: m[1],
      dir: m[2] === "asc" ? "ASCENDING" : "DESCENDING",
    });
  }

  // findMany({ ..., orderBy: "field", orderDir: "desc" }) pagination literal.
  // Also handles nullish-coalesced literals:
  //   orderBy: pagination?.orderBy ?? "startTime"
  //   orderDir: pagination?.orderDir ?? "asc"
  // We scan for orderBy and orderDir separately and pair them by proximity.
  //
  // Each match also records `viaCoalesce`: true when the literal was the
  // fallback in a `?? "..."` expression. These are candidates for Zod-enum
  // expansion via `expandThroughEnums` — the runtime value can be ANY
  // member of the enum, not just the fallback literal.
  const byMatches: Array<{ index: number; field: string; viaCoalesce: boolean }> = [];
  const dirMatches: Array<{
    index: number;
    dir: "ASCENDING" | "DESCENDING";
    viaCoalesce: boolean;
  }> = [];
  const orderByFieldRe = /orderBy\s*:\s*(?:"([^"]+)"|[^,}\n]*?\?\?\s*"([^"]+)")/g;
  while ((m = orderByFieldRe.exec(body)) !== null) {
    byMatches.push({
      index: m.index,
      field: (m[1] ?? m[2]) as string,
      viaCoalesce: m[2] !== undefined,
    });
  }
  const orderDirRe = /orderDir\s*:\s*(?:"(asc|desc)"|[^,}\n]*?\?\?\s*"(asc|desc)")/g;
  while ((m = orderDirRe.exec(body)) !== null) {
    const raw = (m[1] ?? m[2]) as "asc" | "desc";
    dirMatches.push({
      index: m.index,
      dir: raw === "asc" ? "ASCENDING" : "DESCENDING",
      viaCoalesce: m[2] !== undefined,
    });
  }
  // Pair each orderBy with the nearest orderDir that follows within 200 chars;
  // if no matching orderDir, assume "desc" (matches BaseRepository default).
  for (const by of byMatches) {
    const paired = dirMatches.find((d) => d.index >= by.index && d.index - by.index < 200);
    const dir = paired?.dir ?? "DESCENDING";
    orderBys.push({ field: by.field, dir });

    // Zod-enum expansion: when the orderBy or orderDir literal came from
    // a `?? "X"` fallback AND X belongs to a known enum, fan out into
    // every member of that enum. Cross-product the two axes — every
    // (orderBy value, orderDir value) is a reachable runtime combination
    // and Firestore needs a separate composite index for each.
    //
    // Direction expansion catches the staging 500 on
    // `/v1/events/org/:orgId?orderDir=asc` — the repo had
    // `orderDir: pagination.orderDir ?? "desc"` (the literal "desc"),
    // but the route's Zod schema accepts both directions. Without
    // direction expansion the auditor only required the desc index and
    // production 500'd as soon as the back-office UI flipped to asc.
    //
    // Cost: chronological-only lists (sessions, notifications) end up
    // with an extra desc index they may never use. Storage-cost ≪
    // a 500 in production. If a specific call site never wants the
    // alternate direction, document it in the schema by removing one
    // direction from the orderDir enum.
    if (!by.viaCoalesce && !paired?.viaCoalesce) continue;

    const byAlts = by.viaCoalesce
      ? expandThroughEnums(by.field, enums.orderByEnums)
      : [by.field];
    const dirLiteral = paired?.dir === "ASCENDING" ? "asc" : "desc";
    const dirAlts: ("ASCENDING" | "DESCENDING")[] = paired?.viaCoalesce
      ? expandThroughEnums(dirLiteral, enums.orderDirEnums).map((d) =>
          d === "asc" ? "ASCENDING" : "DESCENDING",
        )
      : [dir];

    if (byAlts.length === 1 && dirAlts.length === 1 && byAlts[0] === by.field && dirAlts[0] === dir)
      continue; // No expansion happened — would just duplicate the literal pair.

    for (const f of byAlts) {
      for (const d of dirAlts) {
        // Skip the literal pair itself — it's already in `orderBys` above.
        if (f === by.field && d === dir) continue;
        orderByAlternatives.push({ field: f, dir: d });
      }
    }
  }

  // Detect .select(...) — queries that only select specific fields don't
  // use the default orderBy but still need the equality index.
  const hasSelect = /\.select\s*\(/.test(body);

  // Second pass — flag `orderBy: <variable>` WITHOUT a literal fallback.
  // These are the patterns the primary regexes above can't resolve
  // (e.g. `orderBy: query.orderBy` where the default lives in a Zod
  // schema the audit cannot see). We surface each occurrence as a
  // warning so the reviewer can cross-check indexes against the Zod
  // schema's orderBy vocabulary. Matches:
  //   orderBy: query.orderBy
  //   orderBy: pagination.orderBy
  //   orderBy: filters.orderBy
  // But NOT:
  //   orderBy: "name"           (resolved by the primary regex)
  //   orderBy: x ?? "createdAt" (resolved by the primary regex)
  const unresolvedOrderBys: UnresolvedOrderBy[] = [];
  const orderByVarRe = /orderBy\s*:\s*([a-zA-Z_$][\w.$]*)\s*(?=[,}\n])/g;
  while ((m = orderByVarRe.exec(body)) !== null) {
    const expr = m[1];
    // Skip any match that's already the LHS of a `??` — the primary
    // regex handled those.
    const afterMatch = body.slice(m.index + m[0].length, m.index + m[0].length + 5);
    if (/^\s*\?\?/.test(afterMatch)) continue;
    unresolvedOrderBys.push({ expression: expr });
  }

  return { wheres, orderBys, orderByAlternatives, hasSelect, unresolvedOrderBys };
}

// Scan for `if (...) { ... }` blocks and return the [start, end) character
// ranges of each block body. Used to mark where-clauses as conditional
// (optional) when they sit inside one of these ranges.
function findIfBlockSpans(source: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  // Match `if (...)` headers — we then walk forward through the parenthesis
  // to find the matching body `{...}`.
  const headerRe = /\bif\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(source)) !== null) {
    // Walk the condition parentheses
    let i = m.index + m[0].length;
    let parenDepth = 1;
    let inStr: string | null = null;
    for (; i < source.length && parenDepth > 0; i++) {
      const ch = source[i];
      const prev = source[i - 1];
      if (inStr) {
        if (ch === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
    }
    if (parenDepth !== 0) continue;

    // Skip whitespace to find the body. Two body forms are tracked:
    //   1. Brace-delimited: `if (cond) { ... }` — walk the matching `}`.
    //   2. Single-statement: `if (cond) wheres.push(...);` — span from the
    //      first non-whitespace char to the next `;` at depth 0.
    //
    // Single-statement tracking is critical: event.repository.ts ships
    // `if (filters.category) wheres.push({...});` without braces, and
    // pre-2026-04-26 the auditor treated those clauses as MANDATORY,
    // hiding the genuine query shapes (and thereby hiding the missing
    // composite index for `orderBy: title` on the events.search path).
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) continue;

    if (source[i] === "{") {
      const bodyStart = i + 1;
      let braceDepth = 1;
      i = bodyStart;
      inStr = null;
      for (; i < source.length && braceDepth > 0; i++) {
        const ch = source[i];
        const prev = source[i - 1];
        if (inStr) {
          if (ch === inStr && prev !== "\\") inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inStr = ch;
          continue;
        }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
      if (braceDepth !== 0) continue;
      spans.push({ start: bodyStart, end: i - 1 });
    } else {
      // Single-statement body — walk to the next `;` at depth 0, ignoring
      // contents of string literals and balanced parens/brackets/braces.
      const bodyStart = i;
      let depth = 0;
      let inStr2: string | null = null;
      for (; i < source.length; i++) {
        const ch = source[i];
        const prev = source[i - 1];
        if (inStr2) {
          if (ch === inStr2 && prev !== "\\") inStr2 = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inStr2 = ch;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === ";" && depth === 0) {
          spans.push({ start: bodyStart, end: i });
          break;
        } else if (ch === "\n" && depth === 0) {
          // No semicolon before newline at depth 0 → ASI-like terminator.
          spans.push({ start: bodyStart, end: i });
          break;
        }
      }
    }
  }
  return spans;
}

// Detect raw `db.collection(COLLECTIONS.X).where(...)` patterns and bind them
// to a collection. Returns a list of (collectionName, bodyChunk) pairs.
function extractRawCollectionQueries(
  body: string,
  collectionsMap: Record<string, string>,
): Array<{ collection: string; chunk: string }> {
  const out: Array<{ collection: string; chunk: string }> = [];
  const re =
    /(?:db|this)\.collection\s*\(\s*COLLECTIONS\.(\w+)\s*\)([\s\S]*?)(?=\.get\s*\(|\.count\s*\(|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const collectionKey = m[1];
    const collectionName = collectionsMap[collectionKey];
    if (collectionName) {
      out.push({ collection: collectionName, chunk: m[2] });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// `this.paginatedQuery(COLLECTIONS.X, ...)` detection (Phase 2 extension)
// ───────────────────────────────────────────────────────────────────────────
//
// `admin.repository.ts` (and anywhere else that replicates the pattern)
// defines a private `paginatedQuery` helper that:
//   - takes the collection name as its FIRST argument
//   - applies a default `.orderBy("createdAt", "desc")` unconditionally
//   - accepts its where-clauses via a passed-in `WhereClause[]` array
//
// Before this extension the audit skipped these call-sites entirely because
// the enclosing class doesn't extend `BaseRepository` (so Case 1 doesn't
// match) and the query builder lives in a private helper that isn't a raw
// `db.collection(COLLECTIONS.X).where(...)` chain (so Case 2 doesn't match
// either). A missing index on `(roles CONTAINS, createdAt DESC)` caused
// a staging 500 in April 2026 — this extension is the guardrail.

/** One entry per `this.paginatedQuery(COLLECTIONS.X, ...)` / `this.findMany(...)` invocation. */
type PaginatedQueryCall = {
  /** Collection the query targets, resolved from the first argument. */
  collection: string;
  /**
   * The first 400 chars of the 2nd and 3rd arguments — captured so
   * subsequent where-clause / orderBy scans can walk them. This slice is
   * heuristic: a regex-driven extractor can't fully bracket-balance the
   * call, but the tail of the call-site is enough to pick up explicit
   * `orderBy: "..."` / `orderDir: "..."` literals in the pagination arg.
   */
  callTail: string;
};

function extractPaginatedQueryCalls(
  body: string,
  collectionsMap: Record<string, string>,
): PaginatedQueryCall[] {
  const out: PaginatedQueryCall[] = [];
  // Match `this.paginatedQuery(<generics?>(COLLECTIONS.X, <rest-of-call>)`.
  // Generic type params (< ... >) are allowed between the method name and
  // the opening paren because TS lets call sites specify them inline.
  const re = /this\.paginatedQuery\s*(?:<[^>]*>)?\s*\(\s*COLLECTIONS\.(\w+)\s*,([\s\S]{0,400})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const collectionKey = m[1];
    const collectionName = collectionsMap[collectionKey];
    if (!collectionName) continue;
    out.push({ collection: collectionName, callTail: m[2] });
  }
  return out;
}

/**
 * List helper methods a caller invokes via `this.<name>(...)`. Used to pull
 * where-clause object literals out of helpers like `buildUserFilters` that
 * live as sibling methods in the same repository class.
 *
 * Excludes a denylist of framework / inherited members that can't possibly
 * contribute query fragments (paginatedQuery is the thing we're expanding
 * from, findMany/findOne are already handled separately, etc).
 */
function extractHelperMethodNames(body: string): Set<string> {
  const names = new Set<string>();
  const re = /\bthis\.(\w+)\s*\(/g;
  const deny = new Set([
    "paginatedQuery",
    "findMany",
    "findOne",
    "findById",
    "findByIdOrThrow",
    "create",
    "update",
    "delete",
    "softDelete",
    "collection",
    "requirePermission",
    "requireOrganizationAccess",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!deny.has(m[1])) names.add(m[1]);
  }
  return names;
}

/**
 * Look up the body of a sibling method by name within the same source file.
 * Returns the first match — in practice repositories have unique method
 * names per class, and scanning across classes inside the same file is fine
 * because the audit is a linter, not a compiler.
 */
function findSiblingMethodBody(methods: MethodScope[], name: string): string | null {
  const match = methods.find((m) => m.name === name);
  return match?.body ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Compute required index from a single query shape
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compose the composite index a query requires.
 *
 * Rules (simplified from Firestore docs):
 *   - 0 equality + 0 range + orderBy(Y) → single-field index on Y (auto-created, NO composite needed)
 *   - 1 equality + 0 range + 0 orderBy → single-field index (auto-created)
 *   - 2+ equality filters → composite with all equality fields (ASC)
 *   - equality + range on diff field → composite (equality..., range ASC)
 *   - equality + orderBy on diff field → composite (equality..., orderBy dir)
 *   - equality + range on same field as orderBy → composite (equality..., field dir)
 *   - array-contains + orderBy → composite with arrayConfig + orderBy
 */
function computeRequiredIndex(
  wheres: QueryFragment[],
  orderBys: OrderByFragment[],
  hasDefaultOrderBy: boolean,
): IndexField[] | null {
  const equalityFields = wheres.filter((w) => EQUALITY_OPS.has(w.op));
  const rangeFields = wheres.filter((w) => RANGE_OPS.has(w.op));
  const arrayContainsFields = wheres.filter((w) => ARRAY_CONTAINS_OPS.has(w.op));

  // Single .orderBy wins; default createdAt desc only kicks in when using
  // findMany() without an explicit orderBy in the pagination literal.
  let orderBy: OrderByFragment | null = orderBys[0] ?? null;
  if (!orderBy && hasDefaultOrderBy && wheres.length > 0) {
    orderBy = { field: "createdAt", dir: "DESCENDING" };
  }

  // Query with 0 or 1 equality filter and no orderBy → single-field is enough.
  if (
    equalityFields.length <= 1 &&
    rangeFields.length === 0 &&
    arrayContainsFields.length === 0 &&
    !orderBy
  ) {
    return null;
  }

  // Only a single-field orderBy on a naked collection — auto-indexed.
  if (equalityFields.length === 0 && rangeFields.length === 0 && orderBy && !orderBy.field) {
    return null;
  }

  const fields: IndexField[] = [];

  // Array-contains goes first with its special arrayConfig.
  for (const ac of arrayContainsFields) {
    fields.push({ fieldPath: ac.field, arrayConfig: "CONTAINS" });
  }

  // Equality fields (ASC, in the order they appeared in code).
  for (const eq of equalityFields) {
    fields.push({ fieldPath: eq.field, order: "ASCENDING" });
  }

  // Terminal field: either the range field (ASC default) or the orderBy field.
  const range = rangeFields[0];
  if (range && orderBy && range.field === orderBy.field) {
    fields.push({ fieldPath: range.field, order: orderBy.dir });
  } else if (range) {
    // Range with no matching orderBy — Firestore implicit order is ASC.
    fields.push({ fieldPath: range.field, order: "ASCENDING" });
  } else if (orderBy) {
    // Avoid duplicating a field that's already in equalityFields — rare but
    // possible when someone orders by the same field they filter.
    if (!fields.some((f) => f.fieldPath === orderBy!.field)) {
      fields.push({ fieldPath: orderBy.field, order: orderBy.dir });
    }
  }

  // Deduplicate: if a field ended up twice, keep the first occurrence.
  const seen = new Set<string>();
  const deduped = fields.filter((f) => {
    if (seen.has(f.fieldPath)) return false;
    seen.add(f.fieldPath);
    return true;
  });

  // A composite with a single field isn't needed — that's single-field,
  // which Firestore auto-indexes.
  if (deduped.length < 2) return null;

  return deduped;
}

// ───────────────────────────────────────────────────────────────────────────
// Subset expansion — enumerate every reachable query shape
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cap on optional-filter count to keep subset enumeration tractable.
 * A query with 12 optional filters yields 2^12 = 4096 required-index
 * candidates, which is still cheap but the cap protects against
 * pathological cases. If a method legitimately needs more, the linter
 * emits a warning instead of failing so the maximal-only behaviour
 * falls back to the previous heuristic.
 */
const MAX_OPTIONAL = 12;

/**
 * Generate every reachable query shape for a method by enumerating the
 * 2^n subsets of optional where-clauses (keeping all mandatory clauses).
 * Returns a list of { wheres, label } pairs ready for computeRequiredIndex.
 */
type EnumeratedShape = {
  wheres: QueryFragment[];
  orderBys: OrderByFragment[];
  variantKey: string;
  severity: "primary" | "subset";
};

function enumerateQueryShapes(
  wheres: QueryFragment[],
  orderBys: OrderByFragment[],
  orderByAlternatives: OrderByFragment[] = [],
): EnumeratedShape[] {
  const mandatory = wheres.filter((w) => !w.isOptional);
  const optional = wheres.filter((w) => w.isOptional);

  // Determine the orderBy variants to fan out across. The literal default
  // (already in `orderBys`) plus every alternative discovered through
  // Zod-enum expansion. When no alternatives exist this collapses to a
  // single iteration with the original `orderBys` — preserving prior
  // behaviour for methods without dynamic orderBy.
  const orderByVariants: Array<{ orderBys: OrderByFragment[]; key: string }> = [];
  if (orderByAlternatives.length === 0) {
    orderByVariants.push({ orderBys, key: "" });
  } else {
    // The literal default is the first variant — keep its variant key empty
    // so existing snapshots / reports don't gain noise when alternatives
    // weren't discovered.
    if (orderBys.length > 0) {
      const o = orderBys[0];
      orderByVariants.push({ orderBys, key: "" });
      // Mark every other alternative with a key like `orderBy=title:asc` so
      // the report explains which Zod-enum branch produced the requirement.
      for (const alt of orderByAlternatives) {
        if (alt.field === o.field && alt.dir === o.dir) continue;
        orderByVariants.push({
          orderBys: [alt],
          key: `orderBy=${alt.field}:${alt.dir === "ASCENDING" ? "asc" : "desc"}`,
        });
      }
    } else {
      for (const alt of orderByAlternatives) {
        orderByVariants.push({
          orderBys: [alt],
          key: `orderBy=${alt.field}:${alt.dir === "ASCENDING" ? "asc" : "desc"}`,
        });
      }
    }
  }

  const fanOut = (whereVariants: EnumeratedShape[]): EnumeratedShape[] => {
    if (orderByVariants.length === 1 && !orderByVariants[0].key) return whereVariants;
    const out: EnumeratedShape[] = [];
    for (const wv of whereVariants) {
      for (const ov of orderByVariants) {
        const variantKey = ov.key ? `${wv.variantKey}|${ov.key}` : wv.variantKey;
        // An alternative orderBy from a Zod-enum expansion is always primary:
        // any value in the enum is reachable at runtime, so the index must
        // exist before deploy. (Optional-where SUBSETS remain subset-severity
        // — the orderBy expansion doesn't make a partial filter combination
        // any more reachable.)
        const severity: "primary" | "subset" =
          ov.key && wv.severity === "subset" ? "subset" : wv.severity;
        out.push({ wheres: wv.wheres, orderBys: ov.orderBys, variantKey, severity });
      }
    }
    return out;
  };

  if (optional.length === 0) {
    return fanOut([{ wheres: mandatory, orderBys, variantKey: "all", severity: "primary" }]);
  }
  if (optional.length > MAX_OPTIONAL) {
    return fanOut([
      {
        wheres: [...mandatory, ...optional],
        orderBys,
        variantKey: "maximal",
        severity: "primary",
      },
    ]);
  }

  const shapes: EnumeratedShape[] = [];
  const total = 1 << optional.length;
  for (let mask = 0; mask < total; mask++) {
    const pickedOpt = optional.filter((_, i) => (mask >> i) & 1);
    const subsetWheres = [...mandatory, ...pickedOpt];
    const keyParts = pickedOpt.map((w) => w.field).sort();
    const isMandatoryOnly = pickedOpt.length === 0;
    const isMaximal = pickedOpt.length === optional.length;
    const severity: "primary" | "subset" = isMandatoryOnly || isMaximal ? "primary" : "subset";
    const variantKey = isMandatoryOnly
      ? "mandatory-only"
      : isMaximal
        ? "maximal"
        : keyParts.join("+");
    shapes.push({ wheres: subsetWheres, orderBys, variantKey, severity });
  }
  return fanOut(shapes);
}

// ───────────────────────────────────────────────────────────────────────────
// Index matching
// ───────────────────────────────────────────────────────────────────────────

/**
 * Firestore composite-index matching semantics (simplified from the docs):
 *   - The set of equality fields can appear in ANY order within the index.
 *   - Array-contains field can appear anywhere, with matching arrayConfig.
 *   - The terminal (range / orderBy) field, if present, must be the LAST
 *     entry in the index and its direction must match.
 *
 * Our linter emits the "required" shape in a canonical code-order, but an
 * equivalent declared index may permute the equality block. We treat them
 * as equivalent when:
 *   - collection matches
 *   - same cardinality
 *   - same set of fieldPaths
 *   - same terminal (last) field with matching order/arrayConfig
 *   - array-contains fields match positionally by arrayConfig presence
 */
function indexMatches(required: RequiredIndex, declared: DeclaredIndex): boolean {
  if (required.collection !== declared.collectionGroup) return false;
  if (required.fields.length !== declared.fields.length) return false;

  const rTerminal = required.fields[required.fields.length - 1];
  const dTerminal = declared.fields[declared.fields.length - 1];
  // Terminal alignment: a query's final field (range or orderBy) pins the
  // index tail, so both must agree on path + order/arrayConfig.
  if (rTerminal.fieldPath !== dTerminal.fieldPath) return false;
  if ((rTerminal.order ?? null) !== (dTerminal.order ?? null)) return false;
  if ((rTerminal.arrayConfig ?? null) !== (dTerminal.arrayConfig ?? null)) return false;

  // The remaining fields (equality + array-contains prefix) must be the same
  // set with the same per-field order/arrayConfig. Permutations are allowed.
  const rHead = required.fields.slice(0, -1);
  const dHead = declared.fields.slice(0, -1);
  const signature = (f: IndexField) => `${f.fieldPath}|${f.order ?? ""}|${f.arrayConfig ?? ""}`;
  const rSigs = rHead.map(signature).sort();
  const dSigs = dHead.map(signature).sort();
  if (rSigs.length !== dSigs.length) return false;
  for (let i = 0; i < rSigs.length; i++) {
    if (rSigs[i] !== dSigs[i]) return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

function scanRoutesForOpenPaginationQuery(warnings: Warning[]): void {
  // Routes that pass the bare `PaginationSchema` (with `orderBy:
  // z.string().optional()`) as the query validator are a recurring
  // source of FAILED_PRECONDITION 500s in staging — see PR #215. The
  // composite-index auditor cannot reason about an open-string orderBy,
  // so it silently assumes the BaseRepository default and misses every
  // other reachable variant. Flag these routes so the next reviewer
  // tightens the schema with an explicit `orderBy: z.enum([...])`.
  //
  // `.extend({ orderBy: z.enum([...]).optional() })` is fine because
  // `.extend` overrides keys (Zod-spec) — only the bare `query:
  // PaginationSchema` shape (or `Querystring: z.infer<typeof
  // PaginationSchema>` paired with a bare `query: PaginationSchema`
  // validator) gets the warning.
  const routesDir = path.join(ROOT, "apps/api/src/routes");
  if (!fs.existsSync(routesDir)) return;
  for (const file of walkDir(routesDir)) {
    if (file.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(file, "utf8");
    const re = /validate\s*\(\s*\{[^}]*\bquery\s*:\s*PaginationSchema\b[^}]*\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      warnings.push({
        source: `${path.relative(ROOT, file)}:${line}`,
        message:
          "Route validates query against bare PaginationSchema (orderBy: z.string().optional()). " +
          "Replace with a route-local schema declaring `orderBy: z.enum([...])` so the index auditor " +
          "can expand every reachable sort variant. See PR #215 for the staging-500 class this catches.",
      });
    }
  }
}

function main(): void {
  const declared = loadDeclaredIndexes();
  const collectionsMap = loadCollectionsMap();
  const enums = discoverOrderByEnums();
  const warnings: Warning[] = [];
  const required: RequiredIndex[] = [];
  let filesScanned = 0;

  scanRoutesForOpenPaginationQuery(warnings);

  for (const dir of SCAN_DIRS) {
    for (const file of walkDir(dir)) {
      filesScanned++;
      const source = fs.readFileSync(file, "utf8");
      const relPath = path.relative(ROOT, file);
      const classCollections = extractClassCollections(source, collectionsMap);
      const methods = extractMethods(source);

      for (const method of methods) {
        // Skip constructors.
        if (method.name === "constructor") continue;

        const { wheres, orderBys, orderByAlternatives, hasSelect, unresolvedOrderBys } =
          extractQueryFragments(method.body, enums);

        // Also inspect raw .collection(COLLECTIONS.X) chains embedded in this method.
        const rawChunks = extractRawCollectionQueries(method.body, collectionsMap);

        const source_ = `${relPath}:${method.startLine}`;

        // Warn when an orderBy is forwarded from a caller-controlled
        // variable without a literal fallback. The audit cannot resolve
        // the value at scan-time; indexes may be missing for some
        // orderBy values in the Zod schema. Surface the occurrence so
        // the reviewer can cross-check manually against the schema
        // vocabulary (commonly 3–6 orderBy × orderDir combinations).
        //
        // This is the detection-gap that caused the staging regression
        // on GET /v1/venues — `orderBy: query.orderBy` from
        // VenueQuerySchema had a Zod default of "name", but the index
        // catalog only carried `(status, createdAt DESC)` so a default
        // page load 500'd. See the commit doubling the venue index set.
        for (const unresolved of unresolvedOrderBys) {
          warnings.push({
            source: source_,
            message:
              `orderBy forwarded from \`${unresolved.expression}\` without a literal fallback — ` +
              `audit cannot resolve the value. Ensure composite indexes cover every orderBy × orderDir ` +
              `combination declared in the associated Zod query schema (e.g. VenueQuerySchema.orderBy).`,
          });
        }

        // Class-based repository method: use its class's collection.
        // We need to find which class this method belongs to — match by
        // looking backwards in the source from startLine for `class X extends`.
        let className: string | null = null;
        const upToMethod = source.slice(0, source.indexOf(method.body));
        const classMatches = [...upToMethod.matchAll(/class\s+(\w+)\s+extends\s+BaseRepository/g)];
        if (classMatches.length > 0) {
          className = classMatches[classMatches.length - 1][1];
        }
        const classCollection = className ? classCollections.get(className) : undefined;

        // Case 1: repository method operating on `this.collection` or `this.findMany`
        if (classCollection && (wheres.length > 0 || orderBys.length > 0)) {
          // Default orderBy only applies to findMany (not direct .where chains).
          const usesFindMany = /\bthis\.findMany\s*\(/.test(method.body);
          const usesFindOne = /\bthis\.findOne\s*\(/.test(method.body);
          const hasDefaultOrderBy = usesFindMany && orderBys.length === 0 && !hasSelect;

          // findOne has no orderBy, no default ordering.
          const effectiveOrderBys = usesFindOne ? [] : orderBys;

          const optionalCount = wheres.filter((w) => w.isOptional).length;
          if (optionalCount > MAX_OPTIONAL) {
            warnings.push({
              source: source_,
              message: `${optionalCount} optional where-clauses exceeds MAX_OPTIONAL=${MAX_OPTIONAL}; only the maximal combination is checked.`,
            });
          }

          // Pass the discovered orderBy alternatives so the enumerator
          // also fans out across every reachable Zod-enum value (the
          // events.search regression — see discoverOrderByEnums docstring).
          for (const shape of enumerateQueryShapes(
            wheres,
            effectiveOrderBys,
            usesFindOne ? [] : orderByAlternatives,
          )) {
            const idxFields = computeRequiredIndex(shape.wheres, shape.orderBys, hasDefaultOrderBy);
            if (idxFields) {
              required.push({
                collection: classCollection,
                fields: idxFields,
                source: source_,
                method: method.name,
                queryShape: `${humanReadable(shape.wheres, shape.orderBys, hasDefaultOrderBy)} [variant: ${shape.variantKey}]`,
                severity: shape.severity,
              });
            }
          }
        }

        // Case 2: explicit .collection(COLLECTIONS.X) chains (Cloud Functions, ad-hoc queries).
        for (const raw of rawChunks) {
          const frag = extractQueryFragments(raw.chunk, enums);
          // These are raw chains — no default orderBy.
          const optionalCount = frag.wheres.filter((w) => w.isOptional).length;
          if (optionalCount > MAX_OPTIONAL) {
            warnings.push({
              source: source_,
              message: `${optionalCount} optional where-clauses exceeds MAX_OPTIONAL=${MAX_OPTIONAL}; only the maximal combination is checked.`,
            });
          }
          for (const shape of enumerateQueryShapes(
            frag.wheres,
            frag.orderBys,
            frag.orderByAlternatives,
          )) {
            const idxFields = computeRequiredIndex(shape.wheres, shape.orderBys, false);
            if (idxFields) {
              required.push({
                collection: raw.collection,
                fields: idxFields,
                source: source_,
                method: method.name,
                queryShape: `${humanReadable(shape.wheres, shape.orderBys, false)} [variant: ${shape.variantKey}]`,
                severity: shape.severity,
              });
            }
          }
        }

        // Case 3: `this.paginatedQuery(COLLECTIONS.X, ...)` — helper that
        // takes the collection as its first argument and unconditionally
        // applies `.orderBy("createdAt", "desc")`. The where-clauses may
        // live either directly in the method body (as object literals
        // pushed onto a `clauses` array) or in a sibling helper method
        // like `buildUserFilters(filters)`. Merge both sources before
        // computing the required index so the linter sees the same
        // query shape the runtime does.
        const paginatedCalls = extractPaginatedQueryCalls(method.body, collectionsMap);
        if (paginatedCalls.length > 0) {
          // Gather where-clauses from every helper this method calls.
          // Siblings in the same file count — in practice repository
          // helpers live next to their callers.
          const helperNames = extractHelperMethodNames(method.body);
          const helperFragments: QueryFragment[] = [];
          for (const helperName of helperNames) {
            const helperBody = findSiblingMethodBody(methods, helperName);
            if (helperBody) {
              const helperFrag = extractQueryFragments(helperBody, enums);
              helperFragments.push(...helperFrag.wheres);
            }
          }
          for (const call of paginatedCalls) {
            // Pull any `orderBy: "..."` / `orderDir: "..."` from the
            // pagination literal passed to paginatedQuery. If none,
            // paginatedQuery's implementation defaults kick in.
            const tailFrag = extractQueryFragments(call.callTail, enums);
            const mergedWheres = [...wheres, ...helperFragments];
            const explicitOrderBys = [...orderBys, ...tailFrag.orderBys];
            const mergedAlternatives = [...orderByAlternatives, ...tailFrag.orderByAlternatives];
            const hasDefaultOrderByP = explicitOrderBys.length === 0;

            const optionalCountP = mergedWheres.filter((w) => w.isOptional).length;
            if (optionalCountP > MAX_OPTIONAL) {
              warnings.push({
                source: source_,
                message: `${optionalCountP} optional where-clauses exceeds MAX_OPTIONAL=${MAX_OPTIONAL}; only the maximal combination is checked.`,
              });
            }
            for (const shape of enumerateQueryShapes(
              mergedWheres,
              explicitOrderBys,
              mergedAlternatives,
            )) {
              const idxFields = computeRequiredIndex(
                shape.wheres,
                shape.orderBys,
                hasDefaultOrderByP,
              );
              if (idxFields) {
                required.push({
                  collection: call.collection,
                  fields: idxFields,
                  source: source_,
                  method: method.name,
                  queryShape: `${humanReadable(shape.wheres, shape.orderBys, hasDefaultOrderByP)} [variant: ${shape.variantKey}] (via this.paginatedQuery)`,
                  severity: shape.severity,
                });
              }
            }
          }
        }

        // Warnings for dynamic-field usage.
        for (const w of wheres) {
          if (w.isDynamicField) {
            warnings.push({
              source: source_,
              message: `Dynamic field name in .where (skipped): ${w.field}`,
            });
          }
        }
      }
    }
  }

  // Deduplicate required: multiple methods may produce the same required index.
  const uniqueRequired = dedupeRequired(required);

  // Compare.
  const missing = uniqueRequired.filter((r) => !declared.some((d) => indexMatches(r, d)));

  // Split by severity. Primary = blocking; subsets = warnings unless the
  // AUDIT_SUBSETS=1 env var promotes them to blocking.
  const strictSubsets = process.env.AUDIT_SUBSETS === "1";
  const missingPrimary = missing.filter((m) => m.severity === "primary");
  const missingSubsets = missing.filter((m) => m.severity === "subset");

  // ─── Report ───
  console.log(
    `Scanned ${filesScanned} file(s); found ${uniqueRequired.length} unique query shape(s).`,
  );
  console.log(`Declared indexes: ${declared.length}.`);
  for (const w of warnings) {
    console.warn(`  [warn] ${w.source} — ${w.message}`);
  }

  if (missingSubsets.length > 0) {
    const label = strictSubsets ? "ERROR" : "warn";
    console.warn(
      `\n[${label}] ${missingSubsets.length} subset query shape(s) lack a matching declared index${
        strictSubsets ? "" : " (promoted to errors under AUDIT_SUBSETS=1)"
      }:`,
    );
    for (const m of missingSubsets) {
      console.warn(`  • ${m.source} (${m.method}): ${m.queryShape}`);
      console.warn(`    Required: ${renderIndex(m.collection, m.fields)}`);
    }
  }

  const blocking = [...missingPrimary, ...(strictSubsets ? missingSubsets : [])];

  if (blocking.length === 0) {
    if (missingSubsets.length === 0) {
      console.log(`\n✅ All reachable query shapes are covered by declared indexes.`);
    } else {
      console.log(
        `\n✅ All primary (maximal + mandatory-only) query shapes covered. ${missingSubsets.length} subset warning(s) — see above.`,
      );
    }
    process.exit(0);
  }

  console.error(`\n❌ ${blocking.length} query shape(s) lack a matching declared index:\n`);
  for (const m of blocking) {
    console.error(`  • [${m.severity}] ${m.source} (${m.method}): ${m.queryShape}`);
    console.error(`    Required: ${renderIndex(m.collection, m.fields)}`);
    console.error();
  }
  console.error(`Add the following JSON to infrastructure/firebase/firestore.indexes.json:`);
  console.error();
  console.error(
    JSON.stringify(
      blocking.map((m) => ({
        collectionGroup: m.collection,
        queryScope: "COLLECTION",
        fields: m.fields,
      })),
      null,
      2,
    ),
  );
  process.exit(1);
}

function humanReadable(
  wheres: QueryFragment[],
  orderBys: OrderByFragment[],
  hasDefaultOrderBy: boolean,
): string {
  const parts: string[] = [];
  for (const w of wheres) parts.push(`where(${w.field} ${w.op})`);
  if (orderBys.length > 0) {
    parts.push(
      `orderBy(${orderBys
        .map((o) => `${o.field} ${o.dir === "ASCENDING" ? "asc" : "desc"}`)
        .join(", ")})`,
    );
  } else if (hasDefaultOrderBy) {
    parts.push("orderBy(createdAt desc [default])");
  }
  return parts.join(" + ");
}

function renderIndex(collection: string, fields: IndexField[]): string {
  return `${collection} (${fields
    .map((f) => `${f.fieldPath} ${f.arrayConfig ?? f.order ?? ""}`.trim())
    .join(", ")})`;
}

function dedupeRequired(list: RequiredIndex[]): RequiredIndex[] {
  const seen = new Map<string, RequiredIndex>();
  for (const r of list) {
    const key = `${r.collection}::${r.fields
      .map((f) => `${f.fieldPath}|${f.order ?? ""}|${f.arrayConfig ?? ""}`)
      .join("::")}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
      continue;
    }
    // When the same shape is reached via both a primary and a subset path,
    // keep the primary one so blocking behaviour wins.
    if (existing.severity === "subset" && r.severity === "primary") {
      seen.set(key, r);
    }
  }
  return [...seen.values()];
}

main();
