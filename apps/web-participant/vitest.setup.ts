import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount between tests so React portals / query providers don't leak.
afterEach(() => {
  cleanup();
});
