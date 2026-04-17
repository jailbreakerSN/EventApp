// Eight editorial gradient palettes from the Teranga Participant design
// prototype (teranga-events/project/src/data.jsx → COVERS). Used as the
// fallback background for event cards / featured tiles / detail heroes
// whenever the event has no coverImageURL set.
//
// The palette index is derived deterministically from a stable key
// (typically event.id or event.slug) so the same event always renders
// with the same gradient across pages and reloads.

export const COVER_GRADIENTS = [
  {
    bg: "linear-gradient(135deg, #1A1A2E 0%, #2a473c 55%, #c59e4b 110%)",
    tint: "#c59e4b",
  },
  {
    bg: "linear-gradient(135deg, #c86f4b 0%, #a78336 60%, #172721 100%)",
    tint: "#c86f4b",
  },
  {
    bg: "linear-gradient(135deg, #2a473c 0%, #16213E 60%, #0F9B58 130%)",
    tint: "#0F9B58",
  },
  {
    bg: "linear-gradient(135deg, #c59e4b 0%, #c86f4b 55%, #1A1A2E 100%)",
    tint: "#c59e4b",
  },
  {
    bg: "linear-gradient(135deg, #16213E 0%, #c86f4b 70%, #d1b372 110%)",
    tint: "#d1b372",
  },
  {
    bg: "linear-gradient(135deg, #0F9B58 0%, #2a473c 60%, #1A1A2E 100%)",
    tint: "#0F9B58",
  },
  {
    bg: "linear-gradient(135deg, #1A1A2E 0%, #0F0F1C 100%)",
    tint: "#c59e4b",
  },
  {
    bg: "linear-gradient(135deg, #d1b372 0%, #c59e4b 40%, #a78336 100%)",
    tint: "#a78336",
  },
] as const;

// djb2-ish string hash → uniform bucket index. Deterministic across
// platforms (SSR + client) so hydration doesn't mismatch.
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getCoverGradient(key: string): (typeof COVER_GRADIENTS)[number] {
  const idx = hashKey(key) % COVER_GRADIENTS.length;
  return COVER_GRADIENTS[idx];
}
