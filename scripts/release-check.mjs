import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];

async function main() {
  run("npm", ["run", "lint"], "TypeScript typecheck");
  run("npm", ["run", "build"], "Build CLI");
  const registryLint = runJson("node", ["dist/index.js", "registry", "lint", "--strict", "--json"], "Registry quality lint");
  assert(registryLint.ok === true, "Registry quality lint failed.");
  assert(registryLint.score === 100, `Expected registry lint score 100, found ${registryLint.score}.`);
  assert(registryLint.promptQuality?.averageScore >= 90, `Expected prompt quality average >= 90, found ${registryLint.promptQuality?.averageScore}.`);
  assert(registryLint.promptQuality?.minScore >= 80, `Expected prompt quality minimum >= 80, found ${registryLint.promptQuality?.minScore}.`);
  const registryInfo = runJson("node", ["dist/index.js", "registry", "info", "--json"], "Registry info");
  assert(registryInfo.packCount >= 3, `Expected registry info to report at least three packs, found ${registryInfo.packCount}.`);
  assert(registryInfo.agentCount >= 7, `Expected registry info to report at least seven agents, found ${registryInfo.agentCount}.`);
  assert(registryInfo.changelog?.count >= 1, "Expected registry info to report at least one changelog entry.");
  assert(
    registryInfo.packs?.every((pack) => pack.requires?.agentsMarket),
    "Expected every registry info pack to include an Agents Market version requirement."
  );
  const registryChangelog = runJson("node", ["dist/index.js", "registry", "changelog", "--json"], "Registry changelog");
  assert(registryChangelog.count >= 1, "Expected registry changelog to include at least one entry.");
  assert(registryChangelog.entries?.[0]?.version, "Expected registry changelog latest entry to include a version.");
  await runRegistrySignatureSmoke();
  await runRegistrySubmissionGateSmoke();
  await runIntegrationPackageSmoke();
  run("npm", ["test"], "Unit tests");

  const siteDir = await mkdtemp(join(tmpdir(), "agents-market-release-site-"));
  try {
    run(
      "node",
      ["dist/index.js", "catalog", "build", "--out", siteDir, "--base-url", "https://example.com/agents-market"],
      "Catalog build"
    );
    const catalogVerify = runJson("node", ["dist/index.js", "catalog", "verify", "--dir", siteDir, "--json"], "Catalog verify");
    assert(catalogVerify.ok === true, "Catalog verification failed after build.");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }

  await runLifecycleSmoke();

  const pack = run("npm", ["pack", "--dry-run", "--json"], "Package dry run");
  verifyTarball(parseNpmPackJson(pack.stdout));

  console.log(`\nRelease check passed (${checks.length} checks).`);
}

function run(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  checks.push(label);
  return result;
}

async function runLifecycleSmoke() {
  const projectDir = await mkdtemp(join(tmpdir(), "agents-market-release-lifecycle-"));
  try {
    const init = runJson(
      "node",
      ["dist/index.js", "init", "--cwd", projectDir, "--target", "claude", "--json"],
      "Lifecycle init"
    );
    assert(init.lockWritten === true, "Lifecycle init did not write a registry lock.");
    assert(init.recommendation?.packId, "Lifecycle init did not include a pack recommendation.");
    assert(
      init.nextCommands?.[0] === "agents-market apply starter-dev-pack --target claude --policy-preset balanced --json",
      `Lifecycle init should preview with apply, found: ${init.nextCommands?.[0]}.`
    );
    assert(
      init.nextCommands?.[1] === "agents-market apply starter-dev-pack --target claude --policy-preset balanced --yes",
      `Lifecycle init should install with apply --yes, found: ${init.nextCommands?.[1]}.`
    );
    assert(
      init.nextCommands?.[2] === "agents-market doctor --strict --json",
      `Lifecycle init should verify with strict doctor, found: ${init.nextCommands?.[2]}.`
    );
    assert(
      init.integrations?.some((file) => file.path === ".claude/skills/agents-market-installer/SKILL.md"),
      "Lifecycle init did not plan the Claude installer skill."
    );

    const lock = runJson("node", ["dist/index.js", "registry", "verify-lock", "--cwd", projectDir, "--json"], "Lifecycle verify lock");
    assert(lock.ok === true, "Lifecycle registry lock verification failed.");

    const policyInit = runJson(
      "node",
      ["dist/index.js", "policy", "init", "--cwd", projectDir, "--preset", "balanced", "--json"],
      "Lifecycle policy init"
    );
    assert(policyInit.written === true, "Lifecycle policy init did not write a policy file.");
    assert(policyInit.policy?.maxPermission === "command", "Lifecycle policy init did not use the balanced preset.");

    const policyCheck = runJson(
      "node",
      ["dist/index.js", "policy", "check", "starter-dev-pack", "--cwd", projectDir, "--target", "claude", "--json"],
      "Lifecycle policy check"
    );
    assert(policyCheck.ok === true, "Lifecycle policy check failed for starter-dev-pack under balanced policy.");

    const applyPreview = runJson(
      "node",
      ["dist/index.js", "apply", "--target", "claude", "--cwd", projectDir, "--json"],
      "Lifecycle apply preview"
    );
    assert(applyPreview.installed === false, "Lifecycle apply preview should not install without --yes.");
    assert(applyPreview.pack?.id === "starter-dev-pack", `Expected apply preview to recommend starter-dev-pack, found ${applyPreview.pack?.id}.`);
    assert(applyPreview.compatibility?.ok === true, "Lifecycle apply preview did not include a passing compatibility report.");
    assert(applyPreview.policy?.ok === true, "Lifecycle apply preview did not include a passing policy report.");
    assert(applyPreview.changes?.length === 4, `Expected apply preview to include four changes, found ${applyPreview.changes?.length}.`);

    const blockedApply = runJsonAllowFailure(
      "node",
      ["dist/index.js", "apply", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--policy-preset", "strict", "--yes", "--json"],
      "Lifecycle blocked apply"
    );
    assert(blockedApply.status === 1, `Expected strict apply to exit 1, found ${blockedApply.status}.`);
    assert(blockedApply.json.installed === false, "Expected strict apply to avoid installing files.");
    assert(blockedApply.json.policy?.ok === false, "Expected strict apply to include a failing policy report.");

    const applyInstall = runJson(
      "node",
      ["dist/index.js", "apply", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--enforce-policy", "--yes", "--json"],
      "Lifecycle apply install"
    );
    assert(applyInstall.installed === true, "Expected apply --yes to install files after policy passed.");
    assert(applyInstall.compatibility?.ok === true, "Expected apply install to include a passing compatibility report.");
    assert(applyInstall.policy?.ok === true, "Expected apply install to include a passing policy report.");

    const policyInstallPreview = runJson(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--enforce-policy", "--json"],
      "Lifecycle policy install dry run"
    );
    assert(policyInstallPreview.compatibility?.ok === true, "Lifecycle policy install dry run did not include a passing compatibility report.");
    assert(policyInstallPreview.policy?.ok === true, "Lifecycle policy install dry run did not include a passing policy report.");

    const blockedInstallPreview = runJsonAllowFailure(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--policy-preset", "strict", "--json"],
      "Lifecycle blocked policy install dry run"
    );
    assert(blockedInstallPreview.status === 1, `Expected strict policy install dry run to exit 1, found ${blockedInstallPreview.status}.`);
    assert(blockedInstallPreview.json.policy?.ok === false, "Expected strict policy install dry run to include a failing policy report.");

    run("node", ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--enforce-policy"], "Lifecycle install");

    const cleanStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle clean status");
    assert(cleanStatus.installCount === 1, `Expected one install after lifecycle install, found ${cleanStatus.installCount}.`);
    assert(cleanStatus.installs?.[0]?.packVersion === "0.1.0", "Expected lifecycle status to include installed pack version.");
    const cleanFiles = cleanStatus.installs?.[0]?.files ?? [];
    assert(cleanFiles.length === 4, `Expected four Claude agent files after lifecycle install, found ${cleanFiles.length}.`);
    assert(cleanFiles.every((file) => file.state === "clean"), "Expected all lifecycle-installed files to be clean.");

    const outdated = runJson("node", ["dist/index.js", "outdated", "--cwd", projectDir, "--json"], "Lifecycle outdated check");
    assert(outdated.outdatedCount === 0, `Expected no outdated packs, found ${outdated.outdatedCount}.`);
    assert(outdated.checks?.[0]?.status === "current", `Expected installed pack to be current, found ${outdated.checks?.[0]?.status}.`);

    const doctor = runJson("node", ["dist/index.js", "doctor", "--cwd", projectDir, "--strict", "--json"], "Lifecycle strict doctor");
    assert(doctor.health === "ok", `Expected strict doctor health to be ok, found ${doctor.health}.`);
    assert(
      doctor.checks?.some((check) => check.id === "policy-installed-packs" && check.severity === "pass"),
      "Expected strict doctor to verify installed packs against project policy."
    );

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- local edit from release smoke -->\n", "utf8");

    const driftStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--diff", "--json"], "Lifecycle drift status");
    const driftFile = driftStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(driftFile?.state === "modified", `Expected code-reviewer drift state to be modified, found ${driftFile?.state}.`);
    assert(driftFile?.drift?.addedLines > 0, "Expected drift status to report added lines for the local edit.");

    const keepLocalResolve = runJson(
      "node",
      [
        "dist/index.js",
        "resolve",
        "starter-dev-pack",
        "--target",
        "claude",
        "--cwd",
        projectDir,
        "--strategy",
        "keep-local",
        "--yes",
        "--json"
      ],
      "Lifecycle resolve keep local"
    );
    assert(keepLocalResolve.recorded === 1, `Expected keep-local resolve to record one file, found ${keepLocalResolve.recorded}.`);
    assert(hasAction(keepLocalResolve.installs, "record-local"), "Expected keep-local resolve to report record-local.");

    const afterKeepLocalStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle status after keep local");
    const keptFile = afterKeepLocalStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(keptFile?.state === "clean", `Expected keep-local status to be clean, found ${keptFile?.state}.`);

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- second local edit from release smoke -->\n", "utf8");

    const acceptRegistryResolve = runJson(
      "node",
      [
        "dist/index.js",
        "resolve",
        "starter-dev-pack",
        "--target",
        "claude",
        "--cwd",
        projectDir,
        "--strategy",
        "accept-registry",
        "--yes",
        "--json"
      ],
      "Lifecycle resolve accept registry"
    );
    assert(acceptRegistryResolve.written === 1, `Expected accept-registry resolve to write one file, found ${acceptRegistryResolve.written}.`);
    assert(hasAction(acceptRegistryResolve.installs, "write-registry"), "Expected accept-registry resolve to report write-registry.");

    const afterAcceptStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle status after accept registry");
    const acceptedFile = afterAcceptStatus.installs?.[0]?.files?.find((file) => file.path === ".claude/agents/code-reviewer.md");
    assert(acceptedFile?.state === "clean", `Expected accept-registry status to be clean, found ${acceptedFile?.state}.`);

    await appendFile(join(projectDir, ".claude", "agents", "code-reviewer.md"), "\n<!-- third local edit from release smoke -->\n", "utf8");

    const updateDryRun = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", projectDir, "--dry-run", "--json"],
      "Lifecycle update dry run"
    );
    assert(updateDryRun.skipped === 1, `Expected update dry run to skip one modified file, found ${updateDryRun.skipped}.`);
    assert(hasAction(updateDryRun.updates, "skip-modified"), "Expected update dry run to report a skip-modified action.");

    const uninstallDryRun = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--dry-run", "--json"],
      "Lifecycle uninstall dry run"
    );
    assert(uninstallDryRun.removed === 3, `Expected uninstall dry run to remove three clean files, found ${uninstallDryRun.removed}.`);
    assert(uninstallDryRun.skipped === 1, `Expected uninstall dry run to skip one modified file, found ${uninstallDryRun.skipped}.`);
    assert(hasAction(uninstallDryRun.uninstalls, "skip-modified"), "Expected uninstall dry run to report a skip-modified action.");

    const uninstall = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--json"],
      "Lifecycle uninstall"
    );
    assert(uninstall.removed === 3, `Expected uninstall to remove three clean files, found ${uninstall.removed}.`);
    assert(uninstall.skipped === 1, `Expected uninstall to preserve one modified file, found ${uninstall.skipped}.`);

    const partialStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle partial status");
    assert(partialStatus.installCount === 1, "Expected skipped modified file to remain tracked after uninstall.");
    const remainingFiles = partialStatus.installs?.[0]?.files ?? [];
    assert(remainingFiles.length === 1, `Expected one remaining tracked file, found ${remainingFiles.length}.`);
    assert(remainingFiles[0]?.state === "modified", `Expected remaining file to be modified, found ${remainingFiles[0]?.state}.`);

    const forceUninstall = runJson(
      "node",
      ["dist/index.js", "uninstall", "starter-dev-pack", "--target", "claude", "--cwd", projectDir, "--force", "--json"],
      "Lifecycle force uninstall"
    );
    assert(forceUninstall.removed === 1, `Expected force uninstall to remove the remaining file, found ${forceUninstall.removed}.`);
    assert(forceUninstall.skipped === 0, `Expected force uninstall to skip zero files, found ${forceUninstall.skipped}.`);

    const finalStatus = runJson("node", ["dist/index.js", "status", "--cwd", projectDir, "--json"], "Lifecycle final status");
    assert(finalStatus.installCount === 0, `Expected no installs after force uninstall, found ${finalStatus.installCount}.`);

    const registryBundlePath = join(projectDir, "hosted-registry.bundle.json");
    const manifestRegistryProject = await mkdtemp(join(projectDir, "manifest-registry-"));
    run("node", ["dist/index.js", "registry", "export", "--out", registryBundlePath], "Lifecycle export registry bundle");
    const manifestRegistryInstall = runJson(
      "node",
      ["dist/index.js", "install", "starter-dev-pack", "--target", "claude", "--cwd", manifestRegistryProject, "--registry", registryBundlePath, "--json"],
      "Lifecycle manifest registry install"
    );
    assert(manifestRegistryInstall.installed === true, "Expected manifest registry install to complete.");

    const manifestRegistryUpdate = runJson(
      "node",
      ["dist/index.js", "update", "starter-dev-pack", "--cwd", manifestRegistryProject, "--dry-run", "--json"],
      "Lifecycle manifest registry update"
    );
    assert(
      manifestRegistryUpdate.updates?.[0]?.registry?.value === registryBundlePath,
      `Expected update to use install manifest registry ${registryBundlePath}, found ${manifestRegistryUpdate.updates?.[0]?.registry?.value}.`
    );

    checks.push("Lifecycle smoke assertions");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

async function runRegistrySubmissionGateSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-registry-gate-"));
  try {
    const summaryPath = join(dir, "registry-submission-summary.json");
    run("node", ["scripts/registry-submission-check.mjs", "--summary-json", summaryPath], "Registry submission gate");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert(summary.ok === true, "Expected registry submission summary to be ok.");
    assert(summary.lint?.score === 100, `Expected registry submission summary lint score 100, found ${summary.lint?.score}.`);
    assert(summary.packs?.length >= 3, `Expected registry submission summary to include at least three packs, found ${summary.packs?.length}.`);
    assert(
      summary.packs?.every((pack) => typeof pack.provenance?.withChecksum === "number"),
      "Expected registry submission summary packs to include checksum provenance coverage."
    );
    assert(summary.catalog?.ok === true, "Expected registry submission summary catalog verification to pass.");
    checks.push("Registry submission summary");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runIntegrationPackageSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-integrations-"));
  try {
    run("node", ["dist/index.js", "integrations", "package", "--target", "all", "--out", dir], "Integration package build");
    const required = [
      "agents-market-claude/.claude/skills/agents-market-installer/SKILL.md",
      "agents-market-codex/.codex-plugin/plugin.json",
      "agents-market-codex/skills/agents-market-installer/SKILL.md",
      "agents-market-opencode/.opencode/commands/agents-market.md"
    ];
    for (const file of required) {
      const content = await readFile(join(dir, file), "utf8");
      assert(content.length > 0, `Expected integration package file to be non-empty: ${file}`);
    }
    const manifest = JSON.parse(await readFile(join(dir, "agents-market-codex/.codex-plugin/plugin.json"), "utf8"));
    assert(manifest.name === "agents-market-installer", `Expected Codex plugin name agents-market-installer, found ${manifest.name}.`);
    assert(manifest.skills === "./skills/", `Expected Codex plugin skills path ./skills/, found ${manifest.skills}.`);
    checks.push("Integration package contents");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRegistrySignatureSmoke() {
  const dir = await mkdtemp(join(tmpdir(), "agents-market-release-signature-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = join(dir, "registry-private.pem");
    const publicKeyPath = join(dir, "registry-public.pem");
    const bundlePath = join(dir, "registry.bundle.json");
    await writeFile(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    await writeFile(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");

    run(
      "node",
      [
        "dist/index.js",
        "registry",
        "export",
        "--out",
        bundlePath,
        "--private-key",
        privateKeyPath,
        "--key-id",
        "release-test"
      ],
      "Signed registry export"
    );
    const verified = runJson(
      "node",
      [
        "dist/index.js",
        "registry",
        "verify",
        "--registry",
        bundlePath,
        "--public-key",
        publicKeyPath,
        "--key-id",
        "release-test",
        "--json"
      ],
      "Signed registry verify"
    );
    assert(verified.ok === true, "Signed registry verification failed.");
    assert(verified.signatures?.verified?.ok === true, "Expected signed registry verification result to be ok.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runJson(command, args, label) {
  const result = run(command, args, label);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

function runJsonAllowFailure(command, args, label) {
  process.stdout.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  try {
    checks.push(label);
    return {
      status: result.status,
      json: JSON.parse(result.stdout)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

function hasAction(summaries, action) {
  return summaries?.some((summary) => summary.changes?.some((change) => change.action === action)) ?? false;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyTarball(packOutput) {
  const [tarball] = packOutput;
  if (!tarball?.files) {
    throw new Error("npm pack --json output did not include file metadata.");
  }
  const files = new Set(tarball.files.map((file) => file.path));
  const required = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "LICENSE",
    "dist/index.js",
    "dist/compatibility.js",
    "dist/constants.js",
    "dist/catalog.js",
    "dist/audit.js",
    "dist/doctor.js",
    "dist/drift.js",
    "dist/resolve.js",
    "dist/policy.js",
    "dist/pack.js",
    "dist/prompt-quality.js",
    "dist/version.js",
    "registry/agents/code-reviewer.json",
    "registry/changelog.json",
    "registry/packs/starter-dev-pack.json",
    "docs/agent-native.md",
    "docs/contributing-agents.md",
    "docs/policy.md",
    "integrations/codex-skill/SKILL.md"
  ];
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`Package dry run is missing required files: ${missing.join(", ")}`);
  }
  checks.push("Package contents");
}

function parseNpmPackJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("npm pack --json output did not contain a JSON array.");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease check failed: ${message}`);
  process.exitCode = 1;
});
