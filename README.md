# llm-eval-repo-validator

![CI](https://github.com/Vanessaorozco/llm-eval-repo-validator/actions/workflows/ci.yml/badge.svg)

A zero-dependency Node.js harness for two jobs that sit at the core of code-LLM evaluation:

1. **Repo task validation** — verify that a SWE-bench-style task instance is actually usable as an eval item.
2. **LLM patch evaluation** — have a model write a patch for each validated task and score it against hidden tests.

## Why

Code benchmarks are only as good as their task instances. A task is worthless if its "failing" tests already pass, if the reference fix doesn't make them pass, if it breaks other tests, or if a test is flaky. This tool checks every one of those conditions automatically before any model is scored.

## 1. Task validation

Each task declares a repo + base commit, a gold (reference) patch, a test patch, and two test lists:

| Check | Before gold patch | After gold patch |
|---|---|---|
| FAIL_TO_PASS | must **fail** | must **pass** |
| PASS_TO_PASS | must **pass** | must **pass** |

The whole check can be repeated with --runs N to detect flaky tests. Problems are reported in plain language, e.g.:

~~~
FAIL calc-mislabeled-tests
  - FAIL_TO_PASS test passes before the fix: test/add.test.js
~~~

## 2. Model evaluation

For every task the harness builds a prompt (issue + relevant files), asks the model for a unified diff, applies it to a clean checkout, then applies the hidden test patch and runs the tests. A task is **resolved** only if every FAIL_TO_PASS and PASS_TO_PASS test passes. Failures are categorized: empty_patch, patch_apply_failed, test_patch_conflict, tests_failed, regression.

Two baselines keep the harness honest:

- --model gold — oracle (reference patch). Must score 100%, otherwise the harness or the task is broken.
- --model empty — null baseline. Must score 0%.

## Usage

Requires Node 20.10+ and git.

~~~bash
npm test                                   # unit + integration tests
npm run validate                           # validate every task in tasks/
node src/validate.js tasks --runs 3        # flakiness check
node src/validate.js examples/invalid-task # see a rejected task
npm run eval -- --model gold               # oracle baseline
npm run eval -- --model empty              # null baseline
ANTHROPIC_API_KEY=... npm run eval -- --model claude-sonnet-5-5
~~~

JSON reports are written to reports/.

## Task format

~~~json
{
  "id": "calc-divide-zero",
  "repo": "../../fixtures/calc",
  "base_commit": "optional, for remote repos",
  "setup_cmd": "optional, e.g. npm ci",
  "docker_image": "optional, runs setup and tests inside this image",
  "problem_statement": "divide(a, b) returns Infinity when b is 0...",
  "context_files": ["src/calc.js"],
  "gold_patch_file": "gold.patch",
  "test_patch_file": "test.patch",
  "test_cmd": "node --test {test}",
  "FAIL_TO_PASS": ["test/divide.test.js"],
  "PASS_TO_PASS": ["test/add.test.js"]
}
~~~

repo can be a remote git URL (cloned at base_commit) or a local fixture folder.

## Design decisions

- **Clean checkout per run** — every validation and eval run starts from a fresh temp copy, so runs never contaminate each other.
- **Hidden tests applied after the candidate patch** — the model never sees the tests it is graded on.
- **Tolerant patch application** — retries with --recount, since LLM diffs often have wrong hunk headers; still-unappliable patches are counted as a distinct failure mode instead of crashing.
- **Zero dependencies** — only Node built-ins and git, easy to audit and run in CI.

## Roadmap

- Parallel task execution
- pass@k with multiple samples per task
- LLM-as-judge rubric scoring for patch quality (readability, minimality) alongside test-based scoring
