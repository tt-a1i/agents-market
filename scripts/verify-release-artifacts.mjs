#!/usr/bin/env node
import { verifyReleaseArtifactInput } from "../dist/release-artifacts.js";

const args = parseArgs(process.argv.slice(2));
const input = args.archive ?? args.dir ?? "release-artifacts";

try {
  const report = await verifyReleaseArtifactInput(input, { archive: Boolean(args.archive) });
  if (args.json) {
    console.log(JSON.stringify({ ...report, input }, null, 2));
  } else {
    console.log(`Release artifacts verified in ${input}`);
    console.log(`- version: ${report.version}`);
    console.log(`- artifacts: ${report.artifactCount}`);
    if (report.signatures.registry) console.log(`- registry signature: ok (${report.signatures.registry.keyId})`);
    if (report.signatures.catalog) console.log(`- catalog signature: ok (${report.signatures.catalog.keyId})`);
    console.log(`- SBOM packages: ${report.sbom.packageCount}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (args.json) {
    console.log(JSON.stringify({ ok: false, input, findings: [message] }, null, 2));
  } else {
    console.error(`Release artifact verification failed: ${message}`);
  }
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dir") {
      parsed.dir = values[++index];
    } else if (value === "--archive") {
      parsed.archive = values[++index];
    } else if (value === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}
