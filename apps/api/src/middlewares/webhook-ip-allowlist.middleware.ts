import { isIP } from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * P1-15 (audit H6) — Network-layer defence on payment webhook endpoints.
 *
 * HMAC verification alone is one secret away from compromise. Each
 * provider publishes a stable set of webhook origination CIDRs; we
 * compare `req.ip` against the allowlist BEFORE any HMAC compute so
 * a leaked secret can't be exploited from arbitrary networks.
 *
 * Env-driven configuration (comma-separated, IPv4 / IPv6 / CIDR mix):
 *
 *   WAVE_WEBHOOK_IPS      — Wave's documented webhook source CIDRs
 *   OM_WEBHOOK_IPS        — Orange Money webhook source CIDRs
 *   PAYDUNYA_WEBHOOK_IPS  — PayDunya webhook source CIDRs (Phase 2)
 *   FREE_MONEY_WEBHOOK_IPS — Free Money (Phase 3)
 *   CARD_WEBHOOK_IPS      — card processor (Phase 2 / 3)
 *   MOCK_WEBHOOK_IPS      — mock provider (always optional)
 *
 * Failure semantics:
 *   - env var **unset / empty** → fail-OPEN (development / staging
 *     posture: providers vary their webhook IPs during onboarding,
 *     hard-coding them in dev blocks every test). The middleware
 *     logs once at startup that the allowlist is OFF.
 *   - env var **set** → fail-CLOSED (production posture). A request
 *     from outside the allowlist gets 403 BEFORE the HMAC check
 *     touches the body. Every rejection is logged to stderr with
 *     `req.ip` + `provider` for SRE incident review.
 *
 * Cloud Run note: `app.ts` registers Fastify with `trustProxy: true`,
 * so `req.ip` is the X-Forwarded-For client value, not the upstream
 * proxy. Without trustProxy, every webhook would appear to come from
 * the Cloud Run front-end IP and the allowlist would be useless.
 *
 * Cf. ADR-0015 (composite-key rate limit), CLAUDE.md security
 * hardening § "Trust proxy".
 */

const ENV_BY_PROVIDER: Record<string, string> = {
  wave: "WAVE_WEBHOOK_IPS",
  orange_money: "OM_WEBHOOK_IPS",
  free_money: "FREE_MONEY_WEBHOOK_IPS",
  card: "CARD_WEBHOOK_IPS",
  mock: "MOCK_WEBHOOK_IPS",
  paydunya: "PAYDUNYA_WEBHOOK_IPS",
};

interface ParsedAllowlist {
  /** Single IPs (after canonicalisation). */
  exact: Set<string>;
  /** CIDR ranges, normalised to a (network base BigInt, prefix length) pair. */
  cidrs: Array<{ base: bigint; prefix: number; family: 4 | 6 }>;
}

const PARSED_CACHE = new Map<string, ParsedAllowlist>();

function ipToBigInt(ip: string): { value: bigint; family: 4 | 6 } | null {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    let v = 0n;
    for (const p of parts) v = (v << 8n) | BigInt(p);
    return { value: v, family: 4 };
  }
  if (family === 6) {
    // Expand `::` and parse hex groups.
    const expanded = expandIPv6(ip);
    if (!expanded) return null;
    const groups = expanded.split(":");
    if (groups.length !== 8) return null;
    let v = 0n;
    for (const g of groups) {
      const n = parseInt(g, 16);
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
      v = (v << 16n) | BigInt(n);
    }
    return { value: v, family: 6 };
  }
  return null;
}

function expandIPv6(ip: string): string | null {
  // Handle IPv4-mapped IPv6 (::ffff:1.2.3.4) by converting the trailing
  // dotted-quad to two hex groups.
  let s = ip;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const parts = tail.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  // Expand `::`.
  if (s.includes("::")) {
    const [left, right] = s.split("::");
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0) return null;
    const zeros = Array.from({ length: missing }, () => "0");
    return [...leftGroups, ...zeros, ...rightGroups].map((g) => g || "0").join(":");
  }
  return s;
}

function parseAllowlist(raw: string): ParsedAllowlist {
  const cached = PARSED_CACHE.get(raw);
  if (cached) return cached;
  const out: ParsedAllowlist = { exact: new Set(), cidrs: [] };
  for (const entryRaw of raw.split(",")) {
    const entry = entryRaw.trim();
    if (!entry) continue;
    const [ipPart, prefixPart] = entry.split("/");
    if (!ipPart) continue;
    const parsed = ipToBigInt(ipPart);
    if (!parsed) {
      // Skip silently — malformed entry shouldn't break the whole
      // allowlist. Operator gets the warning via the startup log.
      process.stderr.write(
        `${JSON.stringify({
          level: "warn",
          msg: "webhook_ip_allowlist_skipped_entry",
          entry,
          time: new Date().toISOString(),
        })}\n`,
      );
      continue;
    }
    if (prefixPart === undefined) {
      out.exact.add(`${parsed.family}:${parsed.value.toString()}`);
      continue;
    }
    const prefix = Number(prefixPart);
    const maxPrefix = parsed.family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      process.stderr.write(
        `${JSON.stringify({
          level: "warn",
          msg: "webhook_ip_allowlist_bad_prefix",
          entry,
          time: new Date().toISOString(),
        })}\n`,
      );
      continue;
    }
    // Normalise CIDR to network base by zeroing the host bits.
    const hostBits = BigInt(maxPrefix - prefix);
    const base = (parsed.value >> hostBits) << hostBits;
    out.cidrs.push({ base, prefix, family: parsed.family });
  }
  PARSED_CACHE.set(raw, out);
  return out;
}

function ipMatches(ip: string, allow: ParsedAllowlist): boolean {
  const parsed = ipToBigInt(ip);
  if (!parsed) return false;
  const key = `${parsed.family}:${parsed.value.toString()}`;
  if (allow.exact.has(key)) return true;
  for (const cidr of allow.cidrs) {
    if (cidr.family !== parsed.family) continue;
    const maxPrefix = cidr.family === 4 ? 32 : 128;
    const hostBits = BigInt(maxPrefix - cidr.prefix);
    const candidateBase = (parsed.value >> hostBits) << hostBits;
    if (candidateBase === cidr.base) return true;
  }
  return false;
}

/**
 * Test-friendly entrypoint — checks an IP against a comma-separated
 * allowlist string. Returns `true` if the allowlist is empty (fail-OPEN).
 * Used directly by route tests so they can validate the matcher
 * without spinning up a Fastify instance.
 */
export function isIpAllowed(ip: string | null | undefined, rawAllowlist: string | undefined): boolean {
  if (!rawAllowlist || rawAllowlist.trim().length === 0) return true; // fail-OPEN
  if (!ip) return false;
  return ipMatches(ip, parseAllowlist(rawAllowlist));
}

/**
 * Fastify preHandler that enforces the allowlist on
 * `/v1/payments/webhook/:provider`. Runs BEFORE the handler's HMAC
 * check so a leaked secret from outside the provider's CIDR set
 * can't be exploited.
 *
 * The `provider` is read from request.params; if no env var matches
 * (mock in dev, an unconfigured provider in staging, …) the request
 * is allowed through — the absent env var means "I haven't pinned
 * this provider yet; HMAC is the only line of defence".
 */
export async function webhookIpAllowlist(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { provider } = request.params as { provider?: string };
  if (!provider) return;
  const envVarName = ENV_BY_PROVIDER[provider];
  if (!envVarName) return;
  const raw = process.env[envVarName];
  if (!raw || raw.trim().length === 0) return; // fail-OPEN: dev posture
  const allow = parseAllowlist(raw);
  // If the env var is set but parses to nothing meaningful (every
  // entry malformed), treat as fail-CLOSED — a configured-but-
  // garbage allowlist is an operator error we'd rather catch than
  // silently allow.
  const empty = allow.exact.size === 0 && allow.cidrs.length === 0;
  const ok = !empty && isIpAllowed(request.ip, raw);
  if (!ok) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        msg: "webhook_ip_allowlist_rejected",
        provider,
        ip: request.ip,
        envVar: envVarName,
        requestId: request.id ?? null,
        time: new Date().toISOString(),
      })}\n`,
    );
    await reply.status(403).send({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Adresse IP non autorisée pour ce webhook",
      },
    });
  }
}
