import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDiff, summarize, evalTask } from '../src/eval.js';
import { validateTask } from '../src/validate.js';
import { loadTask } from '../src/lib.js';

const FENCE = String.fromCharCode(96).repeat(3);
const DIFF = '--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n';

test('extractDiff reads a fenced diff block', () => {
  assert.equal(extractDiff('Here you go:\n' + FENCE + 'diff\n' + DIFF + FENCE + '\nDone.'), DIFF);
});

test('extractDiff reads an unfenced diff', () => {
  assert.equal(extractDiff('Sure.\n' + DIFF), DIFF);
});

test('extractDiff returns empty when there is no diff', () => {
  assert.equal(extractDiff('I cannot do that.'), '');
});

test('summarize computes resolve rate and failure reasons', () => {
  const s = summarize([{ resolved: true, reason: 'resolved' }, { resolved: false, reason: 'patch_apply_failed' }]);
  assert.deepEqual(s, { total: 2, resolved: 1, resolve_rate: 0.5, reasons: { resolved: 1, patch_apply_failed: 1 } });
});

const good = loadTask('tasks/calc-divide-zero/task.json');

test('a well-formed task validates as VALID', () => {
  const r = validateTask(good, 2);
  assert.equal(r.status, 'VALID', r.issues.join('; '));
});

test('a mislabeled task is flagged as INVALID', () => {
  const r = validateTask(loadTask('examples/invalid-task/task.json'));
  assert.equal(r.status, 'INVALID');
  assert.ok(r.issues.some((i) => i.includes('passes before the fix: test/add.test.js')));
});

test('oracle (gold) patch resolves the task', async () => {
  assert.equal((await evalTask(good, 'gold')).resolved, true);
});

test('empty patch does not resolve the task', async () => {
  assert.equal((await evalTask(good, 'empty')).reason, 'empty_patch');
});
