import { describe, expect, it, vi } from "vitest";

describe("index scaffold", () => {
  it("logs scaffold ready message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await import("./index.js");
    expect(logSpy).toHaveBeenCalledWith("In-memory ledger pseudocode scaffold is ready.");
    logSpy.mockRestore();
  });
});