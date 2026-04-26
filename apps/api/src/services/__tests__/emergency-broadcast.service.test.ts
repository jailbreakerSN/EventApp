import { describe, it, expect } from "vitest";
import { mergeChannels } from "../emergency-broadcast.service";
import type { CommunicationChannel } from "@teranga/shared-types";

// ─── Emergency broadcast — pure channel-merge helper ─────────────────────
//
// Phase O8. The actual send path is wrapped around the existing
// broadcast service (covered by its own tests). The piece that's
// O8-specific is the channel-merge contract: hard-defaults must
// land even if the operator un-checked them.

describe("mergeChannels — hard defaults always present, dedup, order preserved", () => {
  const HARD_DEFAULTS: CommunicationChannel[] = ["push", "sms"];

  it("returns just the hard-defaults when selected is empty", () => {
    expect(mergeChannels([], HARD_DEFAULTS)).toEqual(["push", "sms"]);
  });

  it("preserves hard-defaults when the operator only picked extras", () => {
    expect(mergeChannels(["whatsapp"], HARD_DEFAULTS)).toEqual(["push", "sms", "whatsapp"]);
  });

  it("re-injects a hard-default the operator un-checked", () => {
    // Operator only kept push — sms must still land.
    expect(mergeChannels(["push"], HARD_DEFAULTS)).toEqual(["push", "sms"]);
  });

  it("dedupes overlapping selections without disturbing order", () => {
    expect(mergeChannels(["push", "sms", "whatsapp"], HARD_DEFAULTS)).toEqual([
      "push",
      "sms",
      "whatsapp",
    ]);
  });

  it("handles email + in_app as extras alongside the defaults", () => {
    expect(mergeChannels(["email", "in_app"], HARD_DEFAULTS)).toEqual([
      "push",
      "sms",
      "email",
      "in_app",
    ]);
  });
});
