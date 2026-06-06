export type VersionComparison = -1 | 0 | 1;

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
