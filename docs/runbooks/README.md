# Runbooks

_Operational playbooks for the Teranga production environment._

| Runbook | When to read |
|---|---|
| [`production-launch.md`](./production-launch.md) | Pre-flight checklist for any release that flips a major risk surface |
| [`backup-restore.md`](./backup-restore.md) | Triggering a Firestore export, restoring from one |

## Conventions

Every runbook in this folder follows the same shape:

1. **TL;DR table** at the top — a 5-line summary for the on-call who
   just got paged.
2. **Prerequisites** — one-time setup steps + how to verify each.
3. **Procedure** — step-by-step, copy-pasteable commands.
4. **Failure modes** — known errors with the resolution for each.
5. **Related** — links to other runbooks + source files that
   implement the procedure.

If a runbook tells you to copy-paste a command, that command MUST be
production-safe (no `--force`, no destructive op without
confirmation). If it isn't, fix the runbook before running the
command.

## Rotation

The runbook index is part of the on-call rotation handover. Update
it within the same PR that ships any new operational procedure.
