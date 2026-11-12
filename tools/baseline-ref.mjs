import {execFileSync} from 'node:child_process';

// Resolve the ref once so a long-running comparison stays on the same snapshot.
export function resolveBaselineCommit(root, ref = process.env.WEB_PVP_BASELINE_REF) {
  if (!ref) throw Error('Set WEB_PVP_BASELINE_REF to the Git revision to compare.');
  return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], {
    cwd: root, encoding: 'utf8'
  }).trim();
}
