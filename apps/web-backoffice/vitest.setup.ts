import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-unmount after every test so state / portals don't leak into the
// next one. Essential when the tree mounts React Query providers.
afterEach(() => {
  cleanup();
});
