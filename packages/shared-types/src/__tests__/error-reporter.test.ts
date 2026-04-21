import { describe, it, expect, vi, afterEach } from "vitest";
import { setErrorReporter, reportError, getErrorReporter } from "../error-reporter";

afterEach(() => {
  setErrorReporter(null);
});

describe("error-reporter", () => {
  it("starts with no registered reporter", () => {
    expect(getErrorReporter()).toBeNull();
  });

  it("forwards errors to the registered reporter with descriptor", () => {
    const spy = vi.fn();
    setErrorReporter(spy);

    const err = new Error("boom");
    const descriptor = { code: "INTERNAL_ERROR", hasCode: true as const };
    reportError(err, descriptor);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err, descriptor);
  });

  it("is a no-op when no reporter is registered", () => {
    expect(() => reportError(new Error("x"), { code: "UNKNOWN", hasCode: false })).not.toThrow();
  });

  it("swallows reporter exceptions so the product UX never breaks", () => {
    const throwing = vi.fn(() => {
      throw new Error("reporter-crashed");
    });
    setErrorReporter(throwing);

    expect(() => reportError(new Error("original"), { code: "X", hasCode: true })).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("lets setErrorReporter(null) clear the reporter", () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    setErrorReporter(null);
    reportError(new Error("x"), { code: "X", hasCode: true });
    expect(spy).not.toHaveBeenCalled();
  });
});
