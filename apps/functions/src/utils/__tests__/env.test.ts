import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTerangaEnv, isProduction, shouldSkipScheduledJobInThisEnv } from "../env";

// ─── env helper coverage ──────────────────────────────────────────────────
//
// Pin both the project-id detection AND the per-job staging policy. The
// first regression we'd ship without these is "cron in staging eats
// provider verify quota" — high-impact, silent, hard to spot in logs.

describe("getTerangaEnv", () => {
  const original = process.env.GCLOUD_PROJECT;

  beforeEach(() => {
    delete process.env.GCLOUD_PROJECT;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GCLOUD_PROJECT;
    } else {
      process.env.GCLOUD_PROJECT = original;
    }
  });

  it('detects production when GCLOUD_PROJECT === "teranga-events-prod"', () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    expect(getTerangaEnv()).toBe("production");
    expect(isProduction()).toBe(true);
  });

  it('detects staging when GCLOUD_PROJECT === "teranga-app-990a8"', () => {
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";
    expect(getTerangaEnv()).toBe("staging");
    expect(isProduction()).toBe(false);
  });

  it("falls back to development for any other project id", () => {
    process.env.GCLOUD_PROJECT = "teranga-some-other-project";
    expect(getTerangaEnv()).toBe("development");
    expect(isProduction()).toBe(false);
  });

  it("falls back to development when GCLOUD_PROJECT is unset", () => {
    expect(getTerangaEnv()).toBe("development");
    expect(isProduction()).toBe(false);
  });
});

describe("shouldSkipScheduledJobInThisEnv", () => {
  const original = process.env.GCLOUD_PROJECT;

  beforeEach(() => {
    delete process.env.GCLOUD_PROJECT;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GCLOUD_PROJECT;
    } else {
      process.env.GCLOUD_PROJECT = original;
    }
    vi.unstubAllEnvs();
  });

  it("returns FALSE in production for every job key (cron always runs in prod)", () => {
    process.env.GCLOUD_PROJECT = "teranga-events-prod";
    expect(shouldSkipScheduledJobInThisEnv("release-available-funds")).toBe(false);
    expect(shouldSkipScheduledJobInThisEnv("reconcile-payments")).toBe(false);
    // Even an unknown key — production never short-circuits scheduled jobs.
    expect(shouldSkipScheduledJobInThisEnv("unknown-job")).toBe(false);
  });

  it("returns TRUE in staging for the registered staging-disabled jobs", () => {
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";
    expect(shouldSkipScheduledJobInThisEnv("release-available-funds")).toBe(true);
    expect(shouldSkipScheduledJobInThisEnv("reconcile-payments")).toBe(true);
  });

  it("returns FALSE in staging for jobs NOT in the staging-disabled set", () => {
    // Jobs we want to keep auto in every env — passive monitoring,
    // Resend reconciliation, auth triggers — must NOT be impacted by
    // the env guard. Pin that here.
    process.env.GCLOUD_PROJECT = "teranga-app-990a8";
    expect(shouldSkipScheduledJobInThisEnv("monitor-bounce-rate")).toBe(false);
    expect(shouldSkipScheduledJobInThisEnv("reconcile-resend-segment")).toBe(false);
    expect(shouldSkipScheduledJobInThisEnv("send-event-reminders")).toBe(false);
  });

  it("returns TRUE in development for staging-disabled jobs (same policy as staging)", () => {
    // Local emulator runs are dev — same suppression so an emulator
    // session doesn't churn audit logs with "no entries due" rows.
    expect(shouldSkipScheduledJobInThisEnv("release-available-funds")).toBe(true);
    expect(shouldSkipScheduledJobInThisEnv("reconcile-payments")).toBe(true);
  });
});
