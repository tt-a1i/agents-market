import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubRepository {
  repository: string;
  cloneUrl: string;
  webUrl: string;
}

export interface ClonedRepository {
  repository: GitHubRepository;
  checkoutDir: string;
  cleanup: () => Promise<void>;
}

export function parseGitHubRepository(input: string): GitHubRepository {
  const shorthand = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    const repository = `${shorthand[1]}/${shorthand[2]}`;
    return {
      repository,
      cloneUrl: `https://github.com/${repository}.git`,
      webUrl: `https://github.com/${repository}`
    };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid GitHub repository: ${input}. Use owner/repo or a github.com URL.`);
  }

  if (url.hostname !== "github.com") {
    throw new Error(`Invalid GitHub repository host: ${url.hostname}. Only github.com URLs are supported.`);
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository URL: ${input}. Expected https://github.com/owner/repo.`);
  }

  const repository = `${owner}/${repo}`;
  return {
    repository,
    cloneUrl: `https://github.com/${repository}.git`,
    webUrl: `https://github.com/${repository}`
  };
}

export function githubTreeUrl(repository: GitHubRepository, ref: string, path?: string): string {
  const cleanPath = path?.replace(/^\/+|\/+$/g, "");
  return cleanPath ? `${repository.webUrl}/tree/${ref}/${cleanPath}` : `${repository.webUrl}/tree/${ref}`;
}

export async function cloneGitHubRepository(input: string, ref?: string): Promise<ClonedRepository> {
  const repository = parseGitHubRepository(input);
  const tempRoot = await mkdtemp(join(tmpdir(), "agents-market-"));
  const checkoutDir = join(tempRoot, "repo");
  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(repository.cloneUrl, checkoutDir);

  try {
    await execFileAsync("git", args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone ${repository.repository}: ${message}`);
  }

  return {
    repository,
    checkoutDir,
    cleanup: () => rm(tempRoot, { recursive: true, force: true })
  };
}
