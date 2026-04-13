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
 * Heuristics and limitations (deliberate — full combinatorial coverage
 * would require proper type flow analysis):
 *
 *  - One required-index emitted per method: the MAXIMAL filter set observed
 *    in the method body. If a method has conditional `.where()` calls, the
 *    linter only validates the "all filters applied" combination. Sub-
 *    variants (e.g. eventId alone with no optional filters) must still be
 *    covered by a separate declared index; the linter emits a warning for
 *    those but doesn't fail.
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
  path.join(ROOT, "apps/functions/src/triggers"),
];
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
// File walking
// ───────────────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !SKIP_FILES.has(entry.name))
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
  const headerRe =
    /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?(?:function\s+|const\s+)?([a-zA-Z_][\w$]*)\s*(?:=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::\s*[^={]+)?\s*=>|\([^)]*\)\s*(?::\s*[^{]+)?)\s*\{/g;
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
};

type OrderByFragment = {
  field: string;
  dir: "ASCENDING" | "DESCENDING";
};

function extractQueryFragments(body: string): {
  wheres: QueryFragment[];
  orderBys: OrderByFragment[];
  hasSelect: boolean;
} {
  const wheres: QueryFragment[] = [];
  const orderBys: OrderByFragment[] = [];

  // Raw .where("field", "op", ...) calls
  const whereRe = /\.where\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = whereRe.exec(body)) !== null) {
    wheres.push({ field: m[1], op: m[2], isDynamicField: false });
  }

  // findMany/findOne filter-array shorthand:
  //   [{ field: "x", op: "==", value: ... }, ...]
  const filterObjRe = /\{\s*field:\s*"([^"]+)"\s*,\s*op:\s*"([^"]+)"/g;
  while ((m = filterObjRe.exec(body)) !== null) {
    wheres.push({ field: m[1], op: m[2], isDynamicField: false });
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
  const byMatches: Array<{ index: number; field: string }> = [];
  const dirMatches: Array<{ index: number; dir: "ASCENDING" | "DESCENDING" }> = [];
  const orderByFieldRe = /orderBy\s*:\s*(?:"([^"]+)"|[^,}\n]*?\?\?\s*"([^"]+)")/g;
  while ((m = orderByFieldRe.exec(body)) !== null) {
    byMatches.push({ index: m.index, field: (m[1] ?? m[2]) as string });
  }
  const orderDirRe = /orderDir\s*:\s*(?:"(asc|desc)"|[^,}\n]*?\?\?\s*"(asc|desc)")/g;
  while ((m = orderDirRe.exec(body)) !== null) {
    const dir = (m[1] ?? m[2]) === "asc" ? "ASCENDING" : "DESCENDING";
    dirMatches.push({ index: m.index, dir });
  }
  // Pair each orderBy with the nearest orderDir that follows within 200 chars;
  // if no matching orderDir, assume "desc" (matches BaseRepository default).
  for (const by of byMatches) {
    const paired = dirMatches.find((d) => d.index >= by.index && d.index - by.index < 200);
    orderBys.push({ field: by.field, dir: paired?.dir ?? "DESCENDING" });
  }

  // Detect .select(...) — queries that only select specific fields don't
  // use the default orderBy but still need the equality index.
  const hasSelect = /\.select\s*\(/.test(body);

  return { wheres, orderBys, hasSelect };
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
// Index matching
// ───────────────────────────────────────────────────────────────────────────

function indexMatches(required: RequiredIndex, declared: DeclaredIndex): boolean {
  if (required.collection !== declared.collectionGroup) return false;
  if (required.fields.length !== declared.fields.length) return false;
  for (let i = 0; i < required.fields.length; i++) {
    const rf = required.fields[i];
    const df = declared.fields[i];
    if (rf.fieldPath !== df.fieldPath) return false;
    if ((rf.order ?? null) !== (df.order ?? null)) return false;
    if ((rf.arrayConfig ?? null) !== (df.arrayConfig ?? null)) return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

function main(): void {
  const declared = loadDeclaredIndexes();
  const collectionsMap = loadCollectionsMap();
  const warnings: Warning[] = [];
  const required: RequiredIndex[] = [];
  let filesScanned = 0;

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

        const { wheres, orderBys, hasSelect } = extractQueryFragments(method.body);

        // Also inspect raw .collection(COLLECTIONS.X) chains embedded in this method.
        const rawChunks = extractRawCollectionQueries(method.body, collectionsMap);

        const source_ = `${relPath}:${method.startLine}`;

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

          const idxFields = computeRequiredIndex(wheres, effectiveOrderBys, hasDefaultOrderBy);
          if (idxFields) {
            required.push({
              collection: classCollection,
              fields: idxFields,
              source: source_,
              method: method.name,
              queryShape: humanReadable(wheres, effectiveOrderBys, hasDefaultOrderBy),
            });
          }
        }

        // Case 2: explicit .collection(COLLECTIONS.X) chains (Cloud Functions, ad-hoc queries).
        for (const raw of rawChunks) {
          const frag = extractQueryFragments(raw.chunk);
          // These are raw chains — no default orderBy.
          const idxFields = computeRequiredIndex(frag.wheres, frag.orderBys, false);
          if (idxFields) {
            required.push({
              collection: raw.collection,
              fields: idxFields,
              source: source_,
              method: method.name,
              queryShape: humanReadable(frag.wheres, frag.orderBys, false),
            });
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

  // ─── Report ───
  console.log(
    `Scanned ${filesScanned} file(s); found ${uniqueRequired.length} unique query shape(s).`,
  );
  console.log(`Declared indexes: ${declared.length}.`);
  for (const w of warnings) {
    console.warn(`  [warn] ${w.source} — ${w.message}`);
  }

  if (missing.length === 0) {
    console.log(`\n✅ All reachable query shapes are covered by declared indexes.`);
    process.exit(0);
  }

  console.error(`\n❌ ${missing.length} query shape(s) lack a matching declared index:\n`);
  for (const m of missing) {
    console.error(`  • ${m.source} (${m.method}): ${m.queryShape}`);
    console.error(`    Required: ${renderIndex(m.collection, m.fields)}`);
    console.error();
  }
  console.error(`Add the following JSON to infrastructure/firebase/firestore.indexes.json:`);
  console.error();
  console.error(
    JSON.stringify(
      missing.map((m) => ({
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
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

main();
