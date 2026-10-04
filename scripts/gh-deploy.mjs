#!/usr/bin/env node
/**
 * Publish the built site (dist/) to GitHub Pages without GitHub Actions.
 *
 * Uploads dist/ as a new commit on the `gh-pages` branch through the REST Git Data API
 * (`gh api`). If Pages isn't configured yet, it enables Pages with that branch as the source.
 * GitHub then serves the branch at https://<owner>.github.io/<repo>/.
 *
 * Usage: node scripts/gh-deploy.mjs   (run `npm run build` first; `npm run deploy` does both)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  api,
  apiOrNull,
  createBlob,
  createTree,
  git,
  remoteBranchSha,
  repoSlug,
  setRemoteBranch,
} from './lib/gh.mjs';

const BRANCH = 'gh-pages';
const DIST = 'dist';

/** Recursively list files under `dir` (including dotfiles like .nojekyll). */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function main() {
  if (!existsSync(join(DIST, 'index.html')))
    throw new Error('dist/index.html missing; run `npm run build`');
  const repo = repoSlug();
  const head = remoteBranchSha(repo, BRANCH);

  // Blobs already on the current gh-pages tree don't need re-uploading (hashed assets rarely change).
  const known = new Set();
  let headTree = null;
  if (head) {
    headTree = api('GET', `repos/${repo}/git/commits/${head}`).tree.sha;
    const tree = api('GET', `repos/${repo}/git/trees/${headTree}?recursive=1`);
    for (const entry of tree.tree) if (entry.type === 'blob') known.add(entry.sha);
  }

  const files = walk(DIST);
  const entries = files.map((file) => {
    const path = relative(DIST, file).split(sep).join('/');
    const sha = git('hash-object', file);
    if (!known.has(sha)) {
      if (createBlob(repo, readFileSync(file)) !== sha)
        throw new Error(`blob mismatch for ${path}`);
      known.add(sha);
    }
    return { path, mode: '100644', sha };
  });
  // Without .nojekyll, GitHub Pages runs Jekyll, which drops files and folders starting with "_".
  if (!entries.some((e) => e.path === '.nojekyll')) {
    entries.push({ path: '.nojekyll', mode: '100644', sha: createBlob(repo, Buffer.alloc(0)) });
  }

  const tree = createTree(repo, entries);
  if (tree === headTree) {
    console.log(`No changes: ${BRANCH} already serves this build.`);
  } else {
    const source = git('rev-parse', '--short', 'HEAD');
    const dirty = git('status', '--porcelain', '--untracked-files=no')
      ? ' (uncommitted changes)'
      : '';
    const commit = api('POST', `repos/${repo}/git/commits`, {
      message: `Deploy ${source}${dirty}`,
      tree,
      parents: head ? [head] : [],
    }).sha;
    // gh-pages only holds build output, so overwriting its history is fine.
    setRemoteBranch(repo, BRANCH, commit, { exists: head !== null, force: true });
    console.log(`Deployed ${entries.length} files to ${repo}:${BRANCH} (${commit.slice(0, 7)}).`);
  }

  const source = { branch: BRANCH, path: '/' };
  let pages = apiOrNull('GET', `repos/${repo}/pages`);
  if (!pages) {
    pages = api('POST', `repos/${repo}/pages`, { source });
    console.log('Enabled GitHub Pages from the gh-pages branch.');
  } else if (pages.build_type !== 'legacy' || pages.source?.branch !== BRANCH) {
    api('PUT', `repos/${repo}/pages`, { build_type: 'legacy', source });
    console.log('Switched GitHub Pages source to the gh-pages branch.');
  }
  console.log(
    `Site: ${pages.html_url ?? `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/`}`,
  );
  console.log('GitHub usually takes about a minute to publish a new deploy.');
}

try {
  main();
} catch (err) {
  console.error(`gh-deploy: ${err.message}`);
  process.exit(1);
}
