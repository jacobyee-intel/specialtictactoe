/**
 * Helpers for talking to git and to the GitHub REST API through the `gh` CLI.
 *
 * We shell out to `gh api` instead of using fetch() because gh already handles
 * authentication and the corporate HTTP(S) proxy configured in the environment.
 */
import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 512 * 1024 * 1024;

/** Run a git command and return trimmed stdout as text. */
export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER }).trimEnd();
}

/** Run a git command and return raw stdout bytes (for blob contents). */
export function gitBuffer(...args) {
  return execFileSync('git', args, { maxBuffer: MAX_BUFFER });
}

/**
 * Call the GitHub REST API via `gh api`. A body, if given, is sent as JSON on stdin.
 * Throws an Error carrying gh's message on any non-2xx response.
 */
export function api(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
  if (body !== undefined) args.push('--input', '-');
  try {
    const out = execFileSync('gh', args, {
      input: body === undefined ? undefined : JSON.stringify(body),
      stdio: [body === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    return out.trim() ? JSON.parse(out) : null;
  } catch (err) {
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    const wrapped = new Error(`gh api ${method} ${path} failed: ${detail || err.message}`);
    wrapped.notFound = /HTTP 404/.test(detail);
    throw wrapped;
  }
}

/** Like api(), but returns null on HTTP 404 instead of throwing. */
export function apiOrNull(method, path, body) {
  try {
    return api(method, path, body);
  } catch (err) {
    if (err.notFound) return null;
    throw err;
  }
}

/** "owner/repo" parsed from the `origin` remote URL. */
export function repoSlug() {
  const url = git('remote', 'get-url', 'origin');
  const match = /github\.com[:/](.+?\/.+?)(?:\.git)?\/?$/.exec(url);
  if (!match) throw new Error(`origin is not a GitHub remote: ${url}`);
  return match[1];
}

/** Current sha of a remote branch, or null if the branch does not exist. */
export function remoteBranchSha(repo, branch) {
  return apiOrNull('GET', `repos/${repo}/git/ref/heads/${branch}`)?.object.sha ?? null;
}

/**
 * Point a remote branch at `sha`, creating the branch if needed.
 * `force: false` makes GitHub reject anything that isn't a fast-forward.
 */
export function setRemoteBranch(repo, branch, sha, { exists, force }) {
  if (exists) api('PATCH', `repos/${repo}/git/refs/heads/${branch}`, { sha, force });
  else api('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
}

/** Upload one blob (base64) and return the sha GitHub computed for it. */
export function createBlob(repo, bytes) {
  return api('POST', `repos/${repo}/git/blobs`, {
    content: bytes.toString('base64'),
    encoding: 'base64',
  }).sha;
}

/**
 * Create a full tree from flat entries ({ path, mode, sha }), where paths may contain
 * slashes; GitHub builds the intermediate subtrees. Returns the new tree's sha.
 */
export function createTree(repo, entries) {
  return api('POST', `repos/${repo}/git/trees`, {
    tree: entries.map(({ path, mode, sha }) => ({ path, mode, type: 'blob', sha })),
  }).sha;
}
