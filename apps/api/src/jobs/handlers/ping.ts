import { z } from "zod";
import { type JobHandler } from "../types";

/**
 * `ping` — trivial smoke-test handler.
 *
 * Every production-grade job runner needs a zero-risk way to prove the
 * end-to-end pipeline: the route, permission gate, registry lookup,
 * single-flight lock, handler invocation, run-doc write, audit event,
 * and UI polling all work as intended. `ping` is that handler.
 *
 * Accepts an optional `{ message }` and returns `"pong: <message>"`
 * (or just `"pong"` when empty). No side effects, no Firestore
 * writes, no external calls. Matches the Sidekiq / Temporal pattern
 * for a "canary" job that operators use as a first smoke test in
 * every environment.
 */

const inputSchema = z
  .object({
    message: z.string().max(200, "message must be ≤ 200 chars").optional(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export const pingHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "ping",
    titleFr: "Ping",
    titleEn: "Ping",
    descriptionFr:
      "Test de plomberie — déclenche un handler sans effet de bord pour vérifier que le job runner est opérationnel.",
    descriptionEn:
      "Plumbing smoke-test — triggers a no-op handler to verify the job runner is wired end-to-end.",
    hasInput: true,
    exampleInput: { message: "hello" },
    dangerNoteFr: null,
    dangerNoteEn: null,
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    ctx.log("ping.invoked", { hasMessage: !!input.message });
    // Honour the AbortSignal even on a trivial handler so the pattern
    // is visible to anyone reading the code as a template.
    if (ctx.signal.aborted) {
      throw new Error("aborted");
    }
    return input.message ? `pong: ${input.message}` : "pong";
  },
};
