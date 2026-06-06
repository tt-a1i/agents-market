import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const args = [
  "dist/index.js",
  "registry",
  "review",
  "--registry",
  options.registry,
  "--catalog-base-url",
  options.catalogBaseUrl,
  "--package",
  options.packageSpec,
  ...(options.summaryJson ? ["--summary-json", options.summaryJson] : []),
  ...(options.summaryMarkdown ? ["--summary-markdown", options.summaryMarkdown] : [])
];

const result = spawnSync("node", args, {
  encoding: "utf8",
  stdio: "inherit"
});

process.exitCode = result.status ?? 1;

function parseArgs(values) {
  const parsed = {
    registry: "./registry",
    catalogBaseUrl: "https://example.com/agents-market",
    packageSpec: "github:tt-a1i/agents-market",
    summaryJson: undefined,
    summaryMarkdown: undefined
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--registry") {
      parsed.registry = requiredValue(values, index, value);
      index += 1;
    } else if (value === "--catalog-base-url") {
      parsed.catalogBaseUrl = requiredValue(values, index, value);
      index += 1;
    } else if (value === "--package") {
      parsed.packageSpec = requiredValue(values, index, value);
      index += 1;
    } else if (value === "--summary-json") {
      parsed.summaryJson = requiredValue(values, index, value);
      index += 1;
    } else if (value === "--summary-markdown") {
      parsed.summaryMarkdown = requiredValue(values, index, value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  return parsed;
}

function requiredValue(values, index, option) {
  const value = values[index + 1];
  if (!value) throw new Error(`Missing value for ${option}.`);
  return value;
}
