export interface TextDriftSummary {
  addedLines: number;
  removedLines: number;
  preview: string[];
}

export function summarizeTextDrift(expected: string, current: string, previewLimit = 20): TextDriftSummary {
  const expectedLines = expected.split(/\r?\n/);
  const currentLines = current.split(/\r?\n/);
  const table = longestCommonSubsequenceLengths(expectedLines, currentLines);
  let expectedIndex = 0;
  let currentIndex = 0;
  let addedLines = 0;
  let removedLines = 0;
  const preview: string[] = [];

  while (expectedIndex < expectedLines.length && currentIndex < currentLines.length) {
    if (expectedLines[expectedIndex] === currentLines[currentIndex]) {
      expectedIndex += 1;
      currentIndex += 1;
    } else if (table[expectedIndex + 1][currentIndex] >= table[expectedIndex][currentIndex + 1]) {
      removedLines += 1;
      pushPreview(preview, `- ${expectedLines[expectedIndex]}`, previewLimit);
      expectedIndex += 1;
    } else {
      addedLines += 1;
      pushPreview(preview, `+ ${currentLines[currentIndex]}`, previewLimit);
      currentIndex += 1;
    }
  }

  while (expectedIndex < expectedLines.length) {
    removedLines += 1;
    pushPreview(preview, `- ${expectedLines[expectedIndex]}`, previewLimit);
    expectedIndex += 1;
  }
  while (currentIndex < currentLines.length) {
    addedLines += 1;
    pushPreview(preview, `+ ${currentLines[currentIndex]}`, previewLimit);
    currentIndex += 1;
  }

  return { addedLines, removedLines, preview };
}

function longestCommonSubsequenceLengths(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }
  return table;
}

function pushPreview(preview: string[], line: string, limit: number): void {
  if (preview.length < limit) preview.push(line);
}
