import { describe, expect, it } from "vitest";
import { summarizeTextDrift } from "../src/drift.js";

describe("drift summaries", () => {
  it("reports added and removed lines with a short preview", () => {
    const summary = summarizeTextDrift("one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n");

    expect(summary.addedLines).toBe(2);
    expect(summary.removedLines).toBe(1);
    expect(summary.preview).toContain("- two");
    expect(summary.preview).toContain("+ TWO");
    expect(summary.preview).toContain("+ four");
  });
});
