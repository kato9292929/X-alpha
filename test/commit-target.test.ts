/**
 * Guards the bug where pipeline #24 appended 299 claims but the commit step said
 * "no new claims": the write target and the CI commit target must agree, and the
 * change-detection must include newly-created untracked files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAIMS_PATH } from '../src/extract/runPipeline.js';

const WORKFLOWS: Record<string, string> = {
  pipeline: '.github/workflows/pipeline.yml',
  score: '.github/workflows/score.yml',
  divergence: '.github/workflows/divergence.yml',
};

test('pipeline write target matches the workflow git add target', () => {
  assert.equal(CLAIMS_PATH, 'data/claims-history.jsonl');
  const yml = readFileSync(WORKFLOWS.pipeline!, 'utf8');
  assert.match(yml, new RegExp(`git add [^\\n]*${CLAIMS_PATH.replace(/\./g, '\\.')}`));
});

test('no workflow relies on unstaged `git diff` (which misses untracked files)', () => {
  for (const [name, path] of Object.entries(WORKFLOWS)) {
    const yml = readFileSync(path, 'utf8');
    assert.doesNotMatch(yml, /git diff --quiet -- data\//, `${name} still uses unstaged git diff`);
    assert.match(yml, /git diff --cached --quiet/, `${name} must check the staged diff`);
    assert.match(yml, /git status --porcelain/, `${name} must log porcelain status`);
  }
});

test('staged diff detects a newly-created untracked file (the root-cause behavior)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xalpha-git-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('commit', '--allow-empty', '-q', '-m', 'init');
  writeFileSync(join(dir, 'new.jsonl'), '{"a":1}\n');

  // Old logic: unstaged diff misses the untracked file -> exits 0 ("no change").
  let unstagedReportsClean = true;
  try { git('diff', '--quiet'); } catch { unstagedReportsClean = false; }
  assert.equal(unstagedReportsClean, true, 'unstaged diff wrongly reports clean for an untracked file');

  // New logic: stage it, then the staged diff detects it -> exits non-zero.
  git('add', 'new.jsonl');
  let stagedReportsClean = true;
  try { git('diff', '--cached', '--quiet'); } catch { stagedReportsClean = false; }
  assert.equal(stagedReportsClean, false, 'staged diff must detect the newly-added file');
});
