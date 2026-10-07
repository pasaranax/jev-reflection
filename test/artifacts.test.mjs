import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifacts } from "../src/perspective.mjs";

test("artifact snapshot includes staged and unstaged work and identifies untracked files without modifying the workspace", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "jev-artifacts-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const exec = promisify(execFile);
  const git = (...args) => exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd });
  await git("init", "--quiet", "--template=");
  await writeFile(join(cwd, "search.js"), "const search = 1;\n");
  await git("add", "search.js");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
  await writeFile(join(cwd, "search.js"), "const search = 2;\n");
  await git("add", "search.js");
  await writeFile(join(cwd, "search.js"), "const search = 3;\n");
  await writeFile(join(cwd, "empty-state.js"), "new artifact\n");
  const before = (await git("status", "--porcelain")).stdout;
  const result = await readArtifacts(cwd);
  assert.equal(result.status, "available");
  assert.match(result.diff, /\+const search = 3;/);
  assert.match(result.files, /\?\? empty-state.js/);
  assert.equal(result.truncated, false);
  assert.equal((await git("status", "--porcelain")).stdout, before);
  await writeFile(join(cwd, "search.js"), "x".repeat(40000));
  const large = await readArtifacts(cwd);
  assert.equal(large.truncated, true);
  assert.ok(large.diff.length <= 24000);
});

test("non-Git tasks keep a usable partial snapshot without presenting missing diffs as complete", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "jev-non-git-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const result = await readArtifacts(cwd);
  assert.equal(result.status, "partial");
  assert.equal(result.diff, "");
  assert.equal(result.truncated, true);
});
