export type VersionComparison = -1 | 0 | 1;
export type VersionRangeOperator = ">" | ">=" | "<" | "<=" | "=";

export function compareVersions(left: string | undefined, right: string | undefined): VersionComparison | undefined {
  if (!left || !right) return undefined;
  if (left === right) return 0;

  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return normalizeComparison(left.localeCompare(right));

  for (let index = 0; index < Math.max(parsedLeft.parts.length, parsedRight.parts.length); index += 1) {
    const leftPart = parsedLeft.parts[index] ?? 0;
    const rightPart = parsedRight.parts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }

  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  return normalizeComparison(parsedLeft.prerelease.localeCompare(parsedRight.prerelease));
}

export function versionStatus(
  installedVersion: string | undefined,
  currentVersion: string | undefined
): "current" | "outdated" | "newer" | "unknown" | "missing" {
  if (!currentVersion) return "missing";
  const comparison = compareVersions(installedVersion, currentVersion);
  if (comparison === undefined) return "unknown";
  if (comparison < 0) return "outdated";
  if (comparison > 0) return "newer";
  return "current";
}

export function satisfiesVersionRange(version: string, range: string | undefined): boolean | undefined {
  if (!range) return true;
  const constraints = range
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (constraints.length === 0) return true;

  for (const constraint of constraints) {
    const match = constraint.match(/^(>=|<=|>|<|=)?\s*(v?\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)$/);
    if (!match) return undefined;
    const operator = (match[1] ?? "=") as VersionRangeOperator;
    const comparison = compareVersions(version, match[2]);
    if (comparison === undefined) return undefined;
    if (!satisfiesComparison(comparison, operator)) return false;
  }
  return true;
}

function parseVersion(version: string): { parts: number[]; prerelease?: string } | undefined {
  const match = version.match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    parts: match[1].split(".").map((part) => Number.parseInt(part, 10)),
    prerelease: match[2]
  };
}

function normalizeComparison(value: number): VersionComparison {
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}

function satisfiesComparison(comparison: VersionComparison, operator: VersionRangeOperator): boolean {
  if (operator === ">") return comparison > 0;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<") return comparison < 0;
  if (operator === "<=") return comparison <= 0;
  return comparison === 0;
}
