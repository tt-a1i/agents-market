import { describe, expect, it } from "vitest";
import { compareVersions, versionStatus } from "../src/version.js";

describe("version utilities", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });

  it("classifies installed pack version status", () => {
    expect(versionStatus("0.1.0", "0.1.0")).toBe("current");
    expect(versionStatus("0.1.0", "0.2.0")).toBe("outdated");
    expect(versionStatus("0.3.0", "0.2.0")).toBe("newer");
    expect(versionStatus(undefined, "0.2.0")).toBe("unknown");
    expect(versionStatus("0.1.0", undefined)).toBe("missing");
  });
});
