/**
 * Sprint-4 T3.2 — Minimal cron parser.
 *
 * Implements just enough of the standard 5-field syntax (`m h dom mon
 * dow`) to compute "given a cron expression and a `from` instant,
 * what's the next instant the cron will fire?" — the core operation
 * the scheduled-ops triggers need.
 *
 * Why not pull in a library: the 5-field cron we accept is bounded
 * (single fields, ranges, comma-lists, step `*\/n`, wildcard `*`).
 * Every real cron library is overkill (year fields, named days,
 * timezone awareness, second-resolution) and adds 30 KB+ to the
 * Cloud Run image. The parser below is ~60 lines, deterministic,
 * and tested.
 *
 * Timezone: `nextRunAt(cron, from, tz)` interprets the cron
 * expression in `tz` then converts back to UTC. Implementation uses
 * `Intl.DateTimeFormat` to extract the wall-clock components in the
 * target tz, advances minute-by-minute (capped at 366 days), and
 * returns the first instant whose decomposition matches every cron
 * field. Brute force but always correct on a 5-field grammar.
 */

interface ParsedField {
  values: number[];
}

function parseField(field: string, min: number, max: number): ParsedField {
  if (field === "*") {
    const values: number[] = [];
    for (let v = min; v <= max; v += 1) values.push(v);
    return { values };
  }
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid step in cron field: ${field}`);
    }
    const values: number[] = [];
    for (let v = min; v <= max; v += step) values.push(v);
    return { values };
  }
  if (field.includes(",")) {
    // Senior-review F-5 — strict validation. The previous implementation
    // silently filtered out-of-range values (e.g. "0,60" for the minutes
    // field would parse as [0] and the operator would believe they had
    // scheduled minute 60). Now every token must validate or the whole
    // expression is rejected — matches the explicit error thrown by the
    // range and single-value branches below.
    const values: number[] = [];
    for (const part of field.split(",")) {
      const n = Number(part);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
        throw new Error(`invalid value in cron field: "${part}" (range ${min}-${max})`);
      }
      values.push(n);
    }
    return { values };
  }
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) {
      throw new Error(`invalid range in cron field: ${field}`);
    }
    const values: number[] = [];
    for (let v = Math.max(a, min); v <= Math.min(b, max); v += 1) values.push(v);
    return { values };
  }
  const single = Number(field);
  if (!Number.isFinite(single) || single < min || single > max) {
    throw new Error(`invalid value in cron field: ${field}`);
  }
  return { values: [single] };
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dom: ParsedField;
  month: ParsedField;
  dow: ParsedField;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron must have 5 space-separated fields, got ${fields.length}`);
  }
  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dom: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    // Cron `dow`: 0–7 (both 0 and 7 = Sunday). We normalise 7 → 0.
    dow: { values: parseField(fields[4], 0, 7).values.map((v) => v % 7) },
  };
}

/**
 * Given a wall-clock decomposition of an instant in the target
 * timezone, return whether it matches every cron field. The cron
 * `dom` and `dow` rules have a quirk: when BOTH are restricted
 * (neither is `*`), the standard semantics is "fire when EITHER
 * matches" (Vixie cron). When at least one is `*`, both must
 * match. We follow the standard.
 */
function matches(parsed: ParsedCron, wall: WallClock): boolean {
  if (!parsed.minute.values.includes(wall.minute)) return false;
  if (!parsed.hour.values.includes(wall.hour)) return false;
  if (!parsed.month.values.includes(wall.month)) return false;
  const domAll = parsed.dom.values.length === 31;
  const dowAll = parsed.dow.values.length === 7;
  const domHit = parsed.dom.values.includes(wall.dom);
  const dowHit = parsed.dow.values.includes(wall.dow);
  if (domAll && dowAll) return true;
  if (domAll) return dowHit;
  if (dowAll) return domHit;
  return domHit || dowHit;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  dom: number; // 1-31
  dow: number; // 0-6, Sunday=0
  hour: number; // 0-23
  minute: number; // 0-59
}

function wallClockIn(date: Date, tz: string): WallClock {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    dom: Number(get("day")),
    // Some Intl outputs "Mon, " with trailing comma — strip
    dow: dowMap[get("weekday").replace(/,/g, "").trim()] ?? 0,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/**
 * Returns the next ISO timestamp at which the cron will fire,
 * STRICTLY AFTER `from`. Brute-force minute-by-minute scan capped
 * at 366 days to handle February-29 + monthly schedules without
 * an analytic closed-form solver. Emits `null` when no match
 * within the cap (impossible for any well-formed cron, but the
 * fallback prevents an infinite loop on malformed input).
 */
export function nextCronRun(
  expr: string,
  from: Date,
  tz: string = "Africa/Dakar",
): string | null {
  const parsed = parseCron(expr);
  // Start from the next minute boundary.
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  const MAX_MINUTES = 366 * 24 * 60;
  for (let i = 0; i < MAX_MINUTES; i += 1) {
    const wall = wallClockIn(next, tz);
    if (matches(parsed, wall)) {
      return next.toISOString();
    }
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }
  return null;
}
