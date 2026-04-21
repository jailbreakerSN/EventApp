# Error Handling — UX Reference

> Status: **canonical** as of 2026-04-21. Supersedes ad-hoc `toast.error(...)` usage in mutation flows. Read this before adding any new error-producing call site.

## Why this exists

We shipped a silent-failure loop: a participant clicked **S'inscrire** on an event that wasn't accepting registrations, the API answered `400 { code: "REGISTRATION_CLOSED" }`, the UI showed a 4-second red toast with a generic French string, and the user was left on the same screen with no explanation, no next step, no trace in client-side observability. That single bug exposed four platform-wide gaps:

1. **Prevention** — the UI offered an action it already knew would fail.
2. **Channel** — a blocking submit error used a transient channel (toast).
3. **Copy** — the message was hardcoded French string, not keyed off `error.code`.
4. **Observability** — no `@sentry/nextjs`, so nobody on the team heard about it.

This document is the contract every new error-producing path should follow. The primitives are shipped; the pattern is repeatable.

---

## The four channels

Match the channel to the severity and persistence required. Never mix them.

| Channel                                               | When                                                                                                        | Visual                                                                           | Persistence                                           | Live region                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Toast**                                             | Non-blocking confirmation / low-severity info ("Promo code applied", "Saved").                              | Sonner, top-right on desktop / top-center on mobile.                             | Auto-dismiss after ~4 s.                              | `aria-live="polite"`                                                          |
| **`<InlineErrorBanner>`**                             | Submit failure, state mismatch, anything the user must see and can act on. **Default for mutation errors.** | Persistent card with icon + kicker + title + description + 1–3 actions.          | Until the user dismisses it or re-tries successfully. | `role="alert"` + `aria-live="assertive"` for destructive, `polite` otherwise. |
| **`<FieldError>`** (use `<FormField>` from shared-ui) | Per-field validation error on a form.                                                                       | Red border + micro-copy directly below the input, linked via `aria-describedby`. | Until the field is corrected.                         | Announced when focus lands on the input.                                      |
| **Blocking state (page-level)**                       | The whole route can't proceed (event cancelled, badge unavailable, session expired).                        | Centered card with illustration/icon, title, description, recovery CTAs.         | Until navigation.                                     | `role="alert"`.                                                               |

**Rule of thumb:** if the user's primary action failed and they must respond before moving forward → `<InlineErrorBanner>`. Never use a toast for this.

---

## The API contract

Every API error follows `{ success: false, error: { code, message, details? } }`. Clients switch on `code` and, when present, `details.reason`. The server message is a default for logs/SMS/mobile clients that haven't wired i18n yet — web clients always render localised copy from the `errors.*` catalog, not the raw `message`.

### Error codes

Defined in [`packages/shared-types/src/api.types.ts`](../../packages/shared-types/src/api.types.ts) (`ERROR_CODES`). Typed errors live in [`apps/api/src/errors/app-error.ts`](../../apps/api/src/errors/app-error.ts).

### Disambiguated errors (`details.reason`)

Some codes represent multiple user-meaningful situations. Attach a typed `reason` to the error's `details` so the UI can render a targeted state.

**`REGISTRATION_CLOSED`** — see [`RegistrationUnavailableReason`](../../packages/shared-types/src/event-availability.ts):

- `event_not_published` — draft event, organizer is still preparing it.
- `event_cancelled` — organizer cancelled the event.
- `event_completed` — event ended and is in completed state.
- `event_archived` — event was archived.
- `event_ended` — registration window expired (`now > event.endDate`).
- `event_full` — capacity reached and approval isn't required.

When adding a similar multi-cause error, define the union in `shared-types`, pass it through `details.reason`, and mirror it in the `errors.*` i18n tree.

---

## The three client primitives

### 1. `computeRegistrationAvailability(event)` — preflight

[`packages/shared-types/src/event-availability.ts`](../../packages/shared-types/src/event-availability.ts)

Pure function that mirrors the server's registration guards. Call it on any page that renders a "Register" CTA or deep-links to the registration flow. When it returns `state: "unavailable"`, replace the CTA with a persistent state card — never let the user trigger a known-invalid request. See `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` for the reference integration.

The same preflight pattern applies to any mutation with known-derivable preconditions: plan-limited features (use `<PlanGate>`), email-verified-required actions, organization-role-gated actions. **Disabled buttons + tooltip + blocking state** beats "let the user try and then apologise".

### 2. `<InlineErrorBanner>` — persistent error UI

[`packages/shared-ui/src/components/inline-error-banner.tsx`](../../packages/shared-ui/src/components/inline-error-banner.tsx)

The canonical blocking error surface. Tokens from the Teranga preset:

- `destructive` tone: `border-destructive/30 bg-destructive/5` — for 500s, validation errors, unknown failures.
- `warning` tone: `border-teranga-clay/30 bg-teranga-clay/5` — for recoverable 4xx (registration closed, event full, plan limit, rate limit).
- `info` tone: `border-border bg-muted/40` — for `CONFLICT` ("already in state").

Supports up to 3 actions + a dismiss control. `role="alert"` announces the error to screen readers; `aria-live` is tuned by severity.

### 3. `useErrorHandler()` — the bridge

[`apps/web-participant/src/hooks/use-error-handler.ts`](../../apps/web-participant/src/hooks/use-error-handler.ts) and its web-backoffice twin.

One function call turns a caught `unknown` into a fully-resolved UI state:

```tsx
const { resolve } = useErrorHandler();

try {
  await registerMutation.mutateAsync({ eventId, ticketTypeId });
} catch (err) {
  const resolved = resolve(err);
  // resolved: { descriptor, severity, title, description, recommendedChannel, toast() }
  if (resolved.recommendedChannel === "banner") {
    setSubmitError(resolved);
  } else {
    resolved.toast();
  }
}
```

Lookup order for copy:

1. `errors.<CODE>.reasons.<reason>.{title,description}` (e.g. `errors.REGISTRATION_CLOSED.reasons.event_cancelled.title`)
2. `errors.<CODE>.{title,description}`
3. `errors.unknown.{title,description}` (fallback — surfaces the server `message` as the description when present)

The hook reports every non-`info` error through the pluggable reporter (Phase 3). No-op until an app registers one — see §Observability.

---

## i18n

The `errors.*` namespace lives in `apps/{web-backoffice,web-participant}/src/i18n/messages/{fr,en,wo}.json`. Every new error code must add a `{ title, description }` entry in French first (the source of truth) and in English; Wolof is opportunistic (partial-coverage bundle — see [`packages/shared-types/src/__tests__/i18n-coverage.test.ts`](../../packages/shared-types/src/__tests__/i18n-coverage.test.ts)).

Copy rules:

- **Title** — 3–7 words, action-first ("Événement complet", "Limite du plan atteinte"). Never "Erreur" alone.
- **Description** — 1–2 sentences. Explain _why_ and _what to do next_. Never mention HTTP status codes, error codes, or internal implementation.
- **Actions** — imperative ("Voir les événements", "Renvoyer le lien"). Never more than 3 on a banner.
- **Tone** — Teranga voice: warm, direct, responsible. Apologise once if the fault is ours; guide otherwise.

---

## Observability

[`packages/shared-types/src/error-reporter.ts`](../../packages/shared-types/src/error-reporter.ts) exposes a single pluggable reporter:

```ts
import { setErrorReporter } from "@teranga/shared-types";
// e.g. apps/web-participant/src/sentry.client.config.ts (future)
import * as Sentry from "@sentry/nextjs";

setErrorReporter((err, descriptor) => {
  Sentry.captureException(err, {
    tags: {
      code: descriptor.code,
      reason: descriptor.reason ?? "none",
      status: descriptor.status ?? 0,
    },
  });
});
```

`useErrorHandler` calls this reporter for every non-`info` error. No vendor is wired in the repo yet — wiring Sentry / Glitchtip / Datadog RUM is a one-line change in the app's client entry point. Until then, development builds emit a structured `console.error("[teranga:error] code=… reason=…", error)` so dev sessions get immediate visibility.

**Always report** — `destructive` and `warning` severities both go to the reporter. The dashboard filter decides what to alert on.

**Never report** — `info` severity (`CONFLICT` = "already registered") is expected user feedback, not a bug. Reporting it would flood the dashboard.

---

## Checklist for new error-producing flows

- [ ] Can the UI **prevent** the action upfront? (check plan, status, dates, capacity). If yes, disable the CTA + show tooltip + render a blocking state when the user is already on the flow.
- [ ] Does the API error have a stable `code`? If it maps to multiple user situations, does it carry `details.reason`?
- [ ] Is there an entry in `errors.*` for French and English (and Wolof if relevant)?
- [ ] Does the failure handler use `useErrorHandler().resolve(err)`? Are blocking failures rendered as `<InlineErrorBanner>` rather than toasts?
- [ ] For page-level dead-ends (event cancelled, session expired), is there a `role="alert"` blocking state with recovery CTAs?
- [ ] Field-level validation errors linked via `aria-describedby`?
- [ ] New strings in French first. `i18n-coverage.test.ts` passes.

---

## File map

| Concern                       | File                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| Registration preflight helper | `packages/shared-types/src/event-availability.ts`                          |
| Error descriptor + severity   | `packages/shared-types/src/error-descriptor.ts`                            |
| Observability hook            | `packages/shared-types/src/error-reporter.ts`                              |
| Banner primitive              | `packages/shared-ui/src/components/inline-error-banner.tsx`                |
| Participant hook              | `apps/web-participant/src/hooks/use-error-handler.ts`                      |
| Backoffice hook               | `apps/web-backoffice/src/hooks/use-error-handler.ts`                       |
| i18n catalog (participant)    | `apps/web-participant/src/i18n/messages/{fr,en,wo}.json` → `errors.*`      |
| i18n catalog (backoffice)     | `apps/web-backoffice/src/i18n/messages/{fr,en,wo}.json` → `errors.*`       |
| Typed errors (API)            | `apps/api/src/errors/app-error.ts`                                         |
| Global error handler (API)    | `apps/api/src/app.ts` (`:161`)                                             |
| Reference integration         | `apps/web-participant/src/app/(authenticated)/register/[eventId]/page.tsx` |
