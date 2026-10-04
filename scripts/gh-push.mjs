#!/usr/bin/env node
/**
 * Push local commits to GitHub through the REST Git Data API (`gh api`) instead of `git push`.
 *
 * Each commit between the remote branch head and the local branch is recreated on GitHub
 * object by object (blobs → tree → commit) with identical content and metadata, so GitHub
 * computes exactly the same SHAs as git did locally. Every SHA is verified before the branch
 * is moved, and the move is fast-forward only, so local and remote history stay identical.
 * Afterwards the local remote-tracking ref (origin/<branch>) is updated to match.
 *
 * Usage: node scripts/gh-push.mjs [--dry-run] [branch]
 *   --dry-run  upload objects and verify SHAs, but do not move the remote branch.
 *              (Unreferenced objects on GitHub are invisible and harmless.)
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  createBlob,
  createTree,
  git,
  gitBuffer,
  api,
  remoteBranchSha,
  repoSlug,
  setRemoteBranch,
} from './lib/gh.mjs';

/** List every blob in a commit's tree as { mode, sha, path }. */
export function listTree(commit) {
  const out = gitBuffer('ls-tree', '-r', '-z', '--full-tree', commit).toString('utf8');
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [mode, type, sha] = meta.split(' ');
      if (type !== 'blob') throw new Error(`${commit}: unsupported tree entry ${type} at ${path}`);
      return { mode, sha, path };
    });
}

/** Convert git's "<unix seconds> <+hhmm>" into ISO 8601 with the same UTC offset. */
export function gitDateToIso(seconds, tz) {
  const sign = tz.startsWith('-') ? -1 : 1;
  const offsetMinutes = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const local = new Date((Number(seconds) + offsetMinutes * 60) * 1000).toISOString().slice(0, 19);
  return `${local}${tz.slice(0, 3)}:${tz.slice(3, 5)}`;
}

/** Parse a raw commit object into the fields the GitHub create-commit API accepts. */
export function parseCommit(sha) {
  const raw = gitBuffer('cat-file', 'commit', sha).toString('utf8');
  const split = raw.indexOf('\n\n');
  const headers = raw.slice(0, split).split('\n');
  const message = raw.slice(split + 2);
  const parents = [];
  const people = {};
  let tree = null;
  for (const header of headers) {
    const [key, ...rest] = header.split(' ');
    const value = rest.join(' ');
    if (key === 'tree') tree = value;
    else if (key === 'parent') parents.push(value);
    else if (key === 'author' || key === 'committer') {
      const match = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(value);
      if (!match) throw new Error(`${sha}: cannot parse ${key} line: ${value}`);
      people[key] = { name: match[1], email: match[2], date: gitDateToIso(match[3], match[4]) };
    } else if (
      key === 'gpgsig' ||
      key === 'gpgsig-sha256' ||
      key === 'encoding' ||
      key === 'mergetag'
    ) {
      throw new Error(`${sha}: commits with a "${key}" header cannot be recreated via the API`);
    }
  }
  return { tree, parents, message, author: people.author, committer: people.committer };
}

/**
 * Recreate one local commit on GitHub, uploading any blobs not in `knownBlobs`.
 * Throws if GitHub's resulting tree or commit SHA differs from the local one.
 */
export function recreateCommit(repo, sha, knownBlobs) {
  const entries = listTree(sha);
  for (const entry of entries) {
    if (knownBlobs.has(entry.sha)) continue;
    const remoteSha = createBlob(repo, gitBuffer('cat-file', 'blob', entry.sha));
    if (remoteSha !== entry.sha) throw new Error(`blob mismatch for ${entry.path}`);
    knownBlobs.add(entry.sha);
  }
  const commit = parseCommit(sha);
  const treeSha = createTree(repo, entries);
  if (treeSha !== commit.tree)
    throw new Error(`${sha}: tree mismatch (${treeSha} != ${commit.tree})`);
  const created = api('POST', `repos/${repo}/git/commits`, commit).sha;
  if (created !== sha) {
    throw new Error(
      `commit mismatch: GitHub produced ${created} for local ${sha}; branch not moved`,
    );
  }
  return created;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const branch = args.find((a) => !a.startsWith('--')) ?? git('rev-parse', '--abbrev-ref', 'HEAD');
  const repo = repoSlug();
  const local = git('rev-parse', '--verify', `refs/heads/${branch}`);
  const remote = remoteBranchSha(repo, branch);

  if (remote === local) {
    git('update-ref', `refs/remotes/origin/${branch}`, local);
    console.log(`${branch} is already up to date on ${repo} (${local.slice(0, 7)}).`);
    return;
  }
  if (remote) {
    try {
      git('cat-file', '-e', `${remote}^{commit}`);
    } catch {
      throw new Error(
        `remote ${branch} is at ${remote}, which is not in the local repo; fetch first`,
      );
    }
    try {
      git('merge-base', '--is-ancestor', remote, local);
    } catch {
      throw new Error(
        `remote ${branch} (${remote.slice(0, 7)}) is not an ancestor of local; refusing to push`,
      );
    }
  }

  const range = remote ? [local, `^${remote}`] : [local];
  const commits = git('rev-list', '--reverse', '--topo-order', ...range)
    .split('\n')
    .filter(Boolean);
  // Blobs in the remote head's tree already exist on GitHub, so skip re-uploading them.
  const knownBlobs = new Set(remote ? listTree(remote).map((e) => e.sha) : []);

  for (const sha of commits) {
    recreateCommit(repo, sha, knownBlobs);
    console.log(`  ✓ ${git('log', '-1', '--format=%h %s', sha)}`);
  }

  if (dryRun) {
    console.log(`Dry run: ${commits.length} commit(s) verified; ${branch} not moved.`);
    return;
  }
  setRemoteBranch(repo, branch, local, { exists: remote !== null, force: false });
  git('update-ref', `refs/remotes/origin/${branch}`, local);
  console.log(`Pushed ${commits.length} commit(s) to ${repo}:${branch} (${local.slice(0, 7)}).`);
}

// Compare real paths: on NFS/symlinked homes, argv[1] and import.meta.url can differ textually.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`gh-push: ${err.message}`);
    process.exit(1);
  }
}
