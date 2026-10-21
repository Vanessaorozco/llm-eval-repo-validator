import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GIT = 'git -c user.email=bot@local -c user.name=bot -c core.autocrlf=false';

export function sh(cmd, cwd, timeoutMs = 120000) {
  // Drop the parent test runner's context so nested "node --test" reports its real exit code.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function must(r, step) {
  if (r.code !== 0) throw new Error(step + ' failed:\n' + r.out.slice(-2000));
  return r;
}

// Wraps a command so it runs inside the task's Docker image when one is declared.
function wrap(task, work, cmd) {
  if (!task.docker_image) return cmd;
  return 'docker run --rm -v "' + work + ':/repo" -w /repo ' + task.docker_image +
    ' sh -c "' + cmd.replace(/"/g, '\\"') + '"';
}

export function loadTask(taskPath) {
  const dir = path.dirname(path.resolve(taskPath));
  const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  const rel = (p) => (p ? path.resolve(dir, p) : null);
  return { ...task, dir, goldPatch: rel(task.gold_patch_file), testPatch: rel(task.test_patch_file) };
}

export function findTasks(target) {
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { recursive: true })
    .filter((f) => path.basename(f) === 'task.json')
    .map((f) => path.join(target, f))
    .sort();
}

// Creates a clean working copy of the repo at base_commit (remote URL or local fixture).
export function prepareRepo(task) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'repoval-'));
  if (/^(https?:|git@)/.test(task.repo)) {
    must(sh(GIT + ' clone --quiet ' + task.repo + ' .', work, 600000), 'clone');
    if (task.base_commit) must(sh(GIT + ' checkout --quiet ' + task.base_commit, work), 'checkout');
  } else {
    fs.cpSync(path.resolve(task.dir, task.repo), work, { recursive: true });
    must(sh(GIT + ' init --quiet', work), 'git init');
    must(sh(GIT + ' add -A', work), 'git add');
    must(sh(GIT + ' commit --quiet -m base', work), 'git commit');
  }
  if (task.setup_cmd) must(sh(wrap(task, work, task.setup_cmd), work, 600000), 'setup');
  return work;
}

export function applyPatch(work, patchFile) {
  const r = sh(GIT + ' apply --whitespace=nowarn "' + patchFile + '"', work);
  if (r.code === 0) return r;
  // LLM-written diffs often have wrong hunk line counts; retry recounting them.
  return sh(GIT + ' apply --whitespace=nowarn --recount "' + patchFile + '"', work);
}

export function runTests(work, task, tests) {
  const res = {};
  for (const t of tests) {
    const cmd = wrap(task, work, task.test_cmd.replace('{test}', t));
    res[t] = sh(cmd, work, task.test_timeout_ms || 120000).code === 0;
  }
  return res;
}

export function cleanup(work) {
  fs.rmSync(work, { recursive: true, force: true });
}

export function writeReport(name, data) {
  fs.mkdirSync('reports', { recursive: true });
  const file = path.join('reports', name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
