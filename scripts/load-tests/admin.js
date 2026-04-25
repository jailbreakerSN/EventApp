/**
 * Sprint-3 T4.5 closure — k6 load test for admin GET surfaces.
 *
 * Goal: confirm the admin back-office stays responsive under
 * realistic concurrent load (50 simultaneous admins, 5-min burst).
 * If any p95 crosses the threshold below, the suite fails the CI
 * job and the offending endpoint becomes a perf-tightening ticket.
 *
 * Run locally against a dev API:
 *   ADMIN_TOKEN=<firebase ID token> k6 run scripts/load-tests/admin.js
 *
 * Run against staging in CI:
 *   k6 run --env BASE_URL=https://staging-api.teranga.events \
 *          --env ADMIN_TOKEN=$STAGING_ADMIN_TOKEN \
 *          scripts/load-tests/admin.js
 *
 * Why these endpoints: every admin first hits `/admin/inbox` on
 * login (heavy — 11 parallel Firestore counts), then drills into
 * the most-clicked lists (`/admin/users`, `/admin/organizations`,
 * `/admin/events`, `/admin/audit`). The cost dashboard
 * (`/admin/usage/firestore`) and revenue dashboard (`/admin/revenue`)
 * are second-order but on the critical path for finance + SOC.
 *
 * Thresholds:
 *   - p95 < 500 ms (industry baseline for admin tooling)
 *   - p99 < 1000 ms (worst-case acceptable on a chilly Cloud Run)
 *   - error rate < 1% (any 5xx = test failure; 401/403 = config bug)
 *
 * The script intentionally exercises READ paths only — load-testing
 * mutations against a shared environment is dangerous. A separate
 * suite (not in this branch) covers the bulk-action mutations
 * against an isolated test project.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  throw new Error("ADMIN_TOKEN env var is required (a Firebase ID token for a super_admin)");
}

const headers = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

// Per-endpoint p95/p99 trends so a single noisy endpoint stands out
// in the summary.
const inboxTrend = new Trend("inbox_response_time", true);
const usersTrend = new Trend("users_response_time", true);
const orgsTrend = new Trend("orgs_response_time", true);
const eventsTrend = new Trend("events_response_time", true);
const auditTrend = new Trend("audit_response_time", true);
const revenueTrend = new Trend("revenue_response_time", true);
const costTrend = new Trend("cost_response_time", true);
const errorRate = new Rate("admin_errors");

export const options = {
  scenarios: {
    admin_burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 }, // ramp-up
        { duration: "2m", target: 50 }, // steady-state
        { duration: "30s", target: 50 }, // sustain
        { duration: "30s", target: 0 }, // ramp-down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    admin_errors: ["rate<0.01"],
    inbox_response_time: ["p(95)<800"], // inbox is ~2x heavier
    users_response_time: ["p(95)<500"],
    orgs_response_time: ["p(95)<500"],
    events_response_time: ["p(95)<500"],
    audit_response_time: ["p(95)<500"],
    revenue_response_time: ["p(95)<700"],
    cost_response_time: ["p(95)<700"],
  },
};

function checkOk(res, label, trend) {
  const ok = check(res, {
    [`${label} status 200`]: (r) => r.status === 200,
    [`${label} body parses`]: (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch {
        return false;
      }
    },
  });
  trend.add(res.timings.duration);
  errorRate.add(!ok);
  return ok;
}

export default function () {
  // 1. Inbox — every admin's first request after login.
  const inbox = http.get(`${BASE_URL}/v1/admin/inbox`, { headers });
  checkOk(inbox, "inbox", inboxTrend);
  sleep(0.5);

  // 2. Users list — most-clicked deep-link.
  const users = http.get(`${BASE_URL}/v1/admin/users?limit=20`, { headers });
  checkOk(users, "users", usersTrend);
  sleep(0.5);

  // 3. Organizations list.
  const orgs = http.get(`${BASE_URL}/v1/admin/organizations?limit=20`, { headers });
  checkOk(orgs, "orgs", orgsTrend);
  sleep(0.5);

  // 4. Events list.
  const events = http.get(`${BASE_URL}/v1/admin/events?limit=20`, { headers });
  checkOk(events, "events", eventsTrend);
  sleep(0.5);

  // 5. Audit log — heavier query (timestamp range + 500-row scan
  //    when a search term is supplied; we pass none here so it
  //    uses the fast path).
  const audit = http.get(`${BASE_URL}/v1/admin/audit-logs?limit=20`, { headers });
  checkOk(audit, "audit", auditTrend);
  sleep(0.5);

  // 6. Revenue dashboard — sums across active subscriptions.
  const revenue = http.get(`${BASE_URL}/v1/admin/revenue`, { headers });
  checkOk(revenue, "revenue", revenueTrend);
  sleep(0.5);

  // 7. Cost dashboard — Sprint-3 T4.2.
  const cost = http.get(`${BASE_URL}/v1/admin/usage/firestore?days=7&topN=10`, { headers });
  checkOk(cost, "cost", costTrend);
  sleep(1);
}

export function handleSummary(data) {
  // Plain JSON output so CI can parse + post a comment on the PR
  // when run via `gh workflow run k6.yml`. The default text summary
  // also stays on stdout.
  return {
    "stdout": textSummary(data),
    "scripts/load-tests/results/admin.json": JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const root = data.metrics;
  const reqs = root.http_reqs?.values?.count ?? 0;
  const errors = root.http_req_failed?.values?.fails ?? 0;
  const p95 = root.http_req_duration?.values["p(95)"] ?? 0;
  const p99 = root.http_req_duration?.values["p(99)"] ?? 0;
  return `
================================================================
Teranga admin load test — Sprint-3 T4.5 closure
----------------------------------------------------------------
Total requests : ${reqs}
HTTP failures  : ${errors}
p95 latency    : ${p95.toFixed(1)} ms
p99 latency    : ${p99.toFixed(1)} ms

Per-endpoint p95:
  inbox    : ${(root.inbox_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  users    : ${(root.users_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  orgs     : ${(root.orgs_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  events   : ${(root.events_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  audit    : ${(root.audit_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  revenue  : ${(root.revenue_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
  cost     : ${(root.cost_response_time?.values["p(95)"] ?? 0).toFixed(1)} ms
================================================================
`;
}
