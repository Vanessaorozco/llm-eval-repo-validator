#!/usr/bin/env node
// Validates SWE-bench-style task instances:
//   before the gold patch: FAIL_TO_PASS must fail, PASS_TO_PASS must pass
//   after the gold patch:  every listed test must pass
// Repeats the whole check N times (--runs) to detect flaky tests.
import { pathToFileURL } from 'node:url';
import { loadTask, findTasks, prepareRepo, applyPatch, runTests, cleanup, writeReport } from './lib.js';

export function validateTask(task, runs = 1) {
  const issues = [];
  const f2p = task.FAIL_TO_PASS || [];
  const p2p = task.PASS_TO_PASS || [];
  const all = [...f2p, ...p2p];
  if (!f2p.length) issues.push('FAIL_TO_PASS is empty: the task does not test the fix');
  if (!task.goldPatch) issues.push('missing gold_patch_file');

  const before = [];
  const after = [];
  for (let i = 0; i < runs && !issues.length; i++) {
    const work = prepareRepo(task);
    try {
      if (task.testPatch && applyPatch(work, task.testPatch).code !== 0) { issues.push('test patch does not apply'); break; }
      before.push(runTests(work, task, all));
      if (applyPatch(work, task.goldPatch).code !== 0) { issues.push('gold patch does not apply'); break; }
      after.push(runTests(work, task, all));
    } finally {
      cleanup(work);
    }
  }

  if (after.length) {
    for (const t of f2p) {
      if (before.some((r) => r[t])) issues.push('FAIL_TO_PASS test passes before the fix: ' + t);
      if (after.some((r) => !r[t])) issues.push('FAIL_TO_PASS test still fails after the fix: ' + t);
    }
    for (const t of p2p) {
      if (before.some((r) => !r[t])) issues.push('PASS_TO_PASS test fails before the fix (broken env?): ' + t);
      if (after.some((r) => !r[t])) issues.push('PASS_TO_PASS test breaks with the fix (regression): ' + t);
    }
    const unstable = (rs, t) => new Set(rs.map((r) => r[t])).size > 1;
    for (const t of all) {
      if (unstable(before, t) || unstable(after, t)) issues.push('flaky across ' + runs + ' runs: ' + t);
    }
  }

  return {
    id: task.id,
    status: issues.length ? 'INVALID' : 'VALID',
    runs,
    issues,
    before: before[0] || null,
    after: after[0] || null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--runs');
  const runs = ri >= 0 ? Number(args[ri + 1]) : 1;
  const targets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--runs');
  const paths = (targets.length ? targets : ['tasks']).flatMap(findTasks);

  const results = [];
  for (const p of paths) {
    let r;
    try {
      r = validateTask(loadTask(p), runs);
    } catch (e) {
      r = { id: p, status: 'ERROR', issues: [e.message] };
    }
    results.push(r);
    const tag = r.status === 'VALID' ? 'PASS ' : 'FAIL ';
    console.log(tag + r.id + (r.issues.length ? '\n  - ' + r.issues.join('\n  - ') : ''));
  }
  const valid = results.filter((r) => r.status === 'VALID').length;
  const file = writeReport('validation.json', { valid, total: results.length, results });
  console.log('\n' + valid + '/' + results.length + ' tasks valid. Report: ' + file);
  process.exitCode = valid === results.length ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
