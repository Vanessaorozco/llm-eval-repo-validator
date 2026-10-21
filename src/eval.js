#!/usr/bin/env node
// Evaluates a model on validated tasks: the model writes a patch, hidden tests
// (test patch) are applied, and the task counts as resolved only if every
// FAIL_TO_PASS and PASS_TO_PASS test passes.
//   --model gold   oracle baseline (gold patch, should score 100%)
//   --model empty  null baseline (no patch, should score 0%)
//   --model <id>   any Anthropic model id (needs ANTHROPIC_API_KEY)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTask, findTasks, prepareRepo, applyPatch, runTests, cleanup, writeReport } from './lib.js';

const FENCE = String.fromCharCode(96).repeat(3);

export function extractDiff(text) {
  const m = text.match(new RegExp(FENCE + '(?:diff|patch)?\\n([\\s\\S]*?)' + FENCE));
  const body = m ? m[1] : text;
  const start = body.search(/^(diff --git|--- )/m);
  return start >= 0 ? body.slice(start).trimEnd() + '\n' : '';
}

export function buildPrompt(task, work) {
  const files = (task.context_files || [])
    .map((f) => '### ' + f + '\n' + FENCE + '\n' + fs.readFileSync(path.join(work, f), 'utf8') + FENCE)
    .join('\n\n');
  return 'You are a software engineer. Fix the following issue in the repository.\n\n' +
    '## Issue\n' + task.problem_statement + '\n\n' +
    '## Relevant files\n' + files + '\n\n' +
    'Reply ONLY with a unified diff (git format, a/ and b/ paths) inside a ' + FENCE + 'diff block. ' +
    'Do not modify or add tests.';
}

async function callClaude(prompt, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()));
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function getPatch(task, work, model) {
  if (model === 'gold') return fs.readFileSync(task.goldPatch, 'utf8');
  if (model === 'empty') return '';
  return extractDiff(await callClaude(buildPrompt(task, work), model));
}

export async function evalTask(task, model) {
  const out = { id: task.id, model, resolved: false, reason: '', f2p: {}, p2p: {}, ms: 0 };
  const t0 = Date.now();
  const work = prepareRepo(task);
  try {
    const patch = await getPatch(task, work, model);
    if (!patch.trim()) { out.reason = 'empty_patch'; return out; }
    const pf = path.join(work, '.candidate.patch');
    fs.writeFileSync(pf, patch);
    const applied = applyPatch(work, pf);
    fs.rmSync(pf);
    if (applied.code !== 0) { out.reason = 'patch_apply_failed'; return out; }
    if (task.testPatch && applyPatch(work, task.testPatch).code !== 0) { out.reason = 'test_patch_conflict'; return out; }
    out.f2p = runTests(work, task, task.FAIL_TO_PASS || []);
    out.p2p = runTests(work, task, task.PASS_TO_PASS || []);
    const ok = (o) => Object.values(o).every(Boolean);
    out.resolved = ok(out.f2p) && ok(out.p2p);
    out.reason = out.resolved ? 'resolved' : !ok(out.p2p) ? 'regression' : 'tests_failed';
    return out;
  } catch (e) {
    out.reason = 'error: ' + e.message.split('\n')[0];
    return out;
  } finally {
    out.ms = Date.now() - t0;
    cleanup(work);
  }
}

export function summarize(results) {
  const total = results.length;
  const resolved = results.filter((r) => r.resolved).length;
  const reasons = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  return { total, resolved, resolve_rate: total ? Number((resolved / total).toFixed(3)) : 0, reasons };
}

async function main() {
  const args = process.argv.slice(2);
  const mi = args.indexOf('--model');
  const model = mi >= 0 ? args[mi + 1] : process.env.ANTHROPIC_MODEL || 'gold';
  const targets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
  const paths = (targets.length ? targets : ['tasks']).flatMap(findTasks);

  const results = [];
  for (const p of paths) {
    const r = await evalTask(loadTask(p), model);
    results.push(r);
    console.log((r.resolved ? 'RESOLVED  ' : 'FAILED    ') + r.id + '  (' + r.reason + ', ' + r.ms + ' ms)');
  }
  const summary = summarize(results);
  const file = writeReport('eval-' + model.replace(/[^\w.-]/g, '_') + '.json', { model, summary, results });
  console.log('\nResolve rate: ' + summary.resolved + '/' + summary.total + ' (' + (summary.resolve_rate * 100).toFixed(1) + '%). Report: ' + file);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
