import assert from "node:assert/strict";
import test from "node:test";
import { JevGuard } from "../src/guard.mjs";

const quiet = { focus: 0.1, cause: 0.1, probe: 0.1, pace: 0.1, perspective: 0.1, reviewableWork: true, optionId: "none", evidenceId: "none" };
const identity = { sessionId: "s", turnId: "t" };
async function start(guard, prompt = "Build an accessible search interface.") {
  const out = await guard.handle({ ...identity, event: "turn_start", prompt });
  return out.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)[1];
}
async function observe(guard, output = "Search interface implemented; keyboard behavior not exercised") {
  return guard.handle({ ...identity, event: "tool_end", toolName: "exec_command", cwd: "/workspace", toolInput: "inspect search", toolResponse: output });
}
const checkpoint = (turnToken, outcome = "") => ({ turnToken, event: "milestone", goal: "Build an accessible search interface.", criteria: [], options: [], assumptions: [], evidenceIds: [], outcome });
const artifacts = async () => ({ status: "available", diff: "diff --git a/search.js b/search.js\n+renderSearch()", diffBase: "HEAD", truncated: false });

test("a perspective request is delivered once and an explained decline informs later checks", async () => {
  let now = 0;
  let captured;
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { captured = state; return { ...quiet, perspective: 0.95 }; }, readArtifacts: artifacts });
  const token = await start(guard);
  await observe(guard);
  const first = (await guard.checkpoint(checkpoint(token))).perspective;
  now = 31_000;
  assert.equal((await guard.checkpoint(checkpoint(token, "Still deciding"))).perspective, undefined);
  await assert.rejects(() => guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "declined" }), TypeError);
  const result = await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "declined", summary: "Reviewer-7 already inspected this exact diff; remaining work is the live UI check." });
  assert.equal(result.status, "recorded");
  now += 31_000;
  assert.equal((await guard.checkpoint(checkpoint(token, "Running UI check"))).perspective, undefined);
  assert.equal(captured.perspective_checkpoint.status, "declined");
  assert.match(captured.perspective_checkpoint.reported_summary, /Reviewer-7/);
});

test("a running supervisor cannot be erased with a decline", async () => {
  const guard = new JevGuard({ evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
  const token = await start(guard);
  await observe(guard);
  const first = (await guard.checkpoint(checkpoint(token))).perspective;
  await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "running", supervisorId: "real-supervisor" });
  await assert.rejects(() => guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "declined", summary: "Changed my mind" }), TypeError);
  assert.equal(guard.turns.get("s:t").perspective.status, "running");
});

test("closing a review does not mark changes after its snapshot as already reviewed", async () => {
  for (const status of ["completed", "unavailable", "declined"]) {
    let now = 0;
    const guard = new JevGuard({ now: () => now, intervalMs: 1e12, evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
    const token = await start(guard);
    await observe(guard, "Original implementation a1");
    const first = (await guard.checkpoint(checkpoint(token))).perspective;
    if (status !== "declined") await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "running", supervisorId: "reviewer" });
    await observe(guard, "New implementation a2, outside the reviewer snapshot");
    await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status, summary: "Review coverage is limited to the original a1 snapshot." });
    now = 31 * 60_000;
    const next = await guard.checkpoint(checkpoint(token, "New implementation still needs inspection"));
    assert.ok(next.perspective, `${status} must not conceal a2`);
    assert.notEqual(next.perspective.requestId, first.requestId);
  }
});

test("perspective creates a clean review packet about the intermediate result, without the conversation or Jev verdict", async () => {
  const guard = new JevGuard({ evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts, readTranscript: async () => [{ role: "assistant", text: "MY_PERSUASIVE_NARRATIVE" }] });
  const token = await start(guard);
  await observe(guard);
  const result = await guard.checkpoint(checkpoint(token));
  assert.equal(result.perspective.status, "requested");
  assert.equal(result.perspective.packet.userDirectives[0], "Build an accessible search interface.");
  assert.match(result.perspective.packet.artifacts.diff, /renderSearch/);
  assert.equal(JSON.stringify(result.perspective.packet).includes("MY_PERSUASIVE_NARRATIVE"), false);
  assert.equal(result.perspective.packet.signals, undefined);
  assert.equal(result.perspective.forkTurns, "none");
  assert.match(result.reflection, /\*\*Jev reflection\*\* — Would a fresh \*\*perspective\*\* change my approach\?/);
});

test("periodic perspective requests a fresh view after thirty minutes of reviewable work even with quiet signals", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, evaluate: async () => quiet, readArtifacts: artifacts });
  const token = await start(guard);
  await observe(guard);
  assert.equal((await guard.checkpoint(checkpoint(token))).perspective, undefined);
  now = 30 * 60_000;
  const out = await guard.checkpoint(checkpoint(token, "Intermediate version available"));
  assert.equal(out.perspective.reason, "periodic");
});

test("unchanged waiting does not request periodic perspective", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, reviewableWork: false }), readArtifacts: artifacts });
  const token = await start(guard);
  now = 30 * 60_000;
  assert.equal((await guard.checkpoint(checkpoint(token))).perspective, undefined);
});

test("one supervisor stays in flight; completed reviews permit later reviews only after cooldown and new work", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
  const token = await start(guard);
  await observe(guard);
  const first = (await guard.checkpoint(checkpoint(token))).perspective;
  assert.ok(first?.requestId);
  await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "running", supervisorId: "reviewer-1" });
  now = 31 * 60_000;
  assert.equal((await guard.checkpoint(checkpoint(token, "Still working"))).perspective, undefined);
  await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "completed", summary: "Add a visible empty state; keep keyboard navigation." });
  now += 31_000;
  assert.equal((await guard.checkpoint(checkpoint(token, "Review considered"))).perspective, undefined);
  now += 30 * 60_000;
  await observe(guard, "Empty state implemented");
  await guard.turns.get("s:t").pending;
  const next = await guard.checkpoint(checkpoint(token, "New result"));
  // A background result may be superseded by the checkpoint; the latest queued
  // evaluation is delivered through the ordinary tool hook.
  now += 31_000;
  await observe(guard, "Empty state rendered");
  await guard.turns.get("s:t").pending;
  const state = guard.turns.get("s:t");
  assert.notEqual(state.perspective.requestId, first.requestId);
  assert.equal(state.perspective.status, "requested");
});

test("steering during supervisor launch accepts the late receipt and tracks it until completion", async () => {
  for (const nextTurnId of ["t", "new-turn"]) {
    let now = 0;
    const guard = new JevGuard({ now: () => now, intervalMs: 24 * 60 * 60_000, evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
    const token = await start(guard);
    await observe(guard);
    const request = (await guard.checkpoint(checkpoint(token))).perspective;
    const steering = await guard.handle({ ...identity, turnId: nextTurnId, event: "turn_start", prompt: "Only inspect existing behavior." });
    assert.match(steering.hookSpecificOutput.additionalContext, /Do not launch/);
    const nextToken = steering.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)[1];
    now = 31 * 60_000;
    await guard.handle({ ...identity, turnId: nextTurnId, event: "tool_end", toolName: "read", toolResponse: "New findings while launch receipt is pending" });
    assert.equal((await guard.checkpoint(checkpoint(nextToken))).perspective, undefined, "Wait for the original launch outcome before requesting another supervisor");
    const running = await guard.perspectiveStatus({ turnToken: token, requestId: request.requestId, status: "running", supervisorId: "already-launched" });
    assert.equal(running.status, "superseded");
    now = 31 * 60_000;
    await guard.handle({ ...identity, turnId: nextTurnId, event: "tool_end", toolName: "read", toolResponse: "New findings" });
    assert.equal((await guard.checkpoint(checkpoint(nextToken))).perspective, undefined, "Do not overlap the actual running supervisor");
    const completed = await guard.perspectiveStatus({ turnToken: token, requestId: request.requestId, status: "completed", summary: "Findings from old snapshot" });
    assert.equal(completed.status, "superseded");
    assert.equal([...guard.turns.values()].some((turn) => turn.perspective?.status === "running"), false);
  }
});

test("a superseded supervisor that was not launched can close as unavailable", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, intervalMs: 24 * 60 * 60_000, evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
  const token = await start(guard);
  await observe(guard);
  const first = (await guard.checkpoint(checkpoint(token))).perspective;
  await start(guard, "Now inspect the updated result.");
  assert.equal((await guard.perspectiveStatus({ turnToken: token, requestId: first.requestId, status: "unavailable", summary: "Not launched before the new directive" })).status, "superseded");
  now = 31 * 60_000;
  await observe(guard, "Updated result");
  const second = (await guard.checkpoint(checkpoint(token))).perspective;
  assert.ok(second);
  assert.notEqual(second.requestId, first.requestId);
});

test("a perspective receipt after lost state is skipped without adopting another chat's request", async () => {
  const guard = new JevGuard({ evaluate: async () => quiet });
  const token = await start(guard);
  const result = await guard.perspectiveStatus({ turnToken: token, requestId: "missing-request", status: "running", supervisorId: "old-supervisor" });
  assert.equal(result.status, "superseded");
  assert.equal(guard.turns.get("s:t").perspective, null);
});

test("steering cannot overlap a running supervisor, but its stale completion can close the lifecycle", async () => {
  for (const nextTurnId of ["t", "new-turn"]) {
    let now = 0;
    const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, perspective: 0.95 }), readArtifacts: artifacts });
    const token = await start(guard);
    await observe(guard);
    const request = (await guard.checkpoint(checkpoint(token))).perspective;
    await guard.perspectiveStatus({ turnToken: token, requestId: request.requestId, status: "running", supervisorId: "old-reviewer" });
    const next = await guard.handle({ ...identity, turnId: nextTurnId, event: "turn_start", prompt: "Now improve the empty state." });
    const nextToken = next.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)[1];
    now = 31 * 60_000;
    const current = guard.turns.get(`s:${nextTurnId}`);
    // No periodic evaluation here: exercise the direct checkpoint path.
    guard.intervalMs = 24 * 60 * 60_000;
    await guard.handle({ ...identity, turnId: nextTurnId, event: "tool_end", toolName: "read", toolResponse: "New empty state" });
    assert.equal((await guard.checkpoint(checkpoint(nextToken))).perspective, undefined);
    const closed = await guard.perspectiveStatus({ turnToken: token, requestId: request.requestId, status: "completed", summary: "Findings for old goal" });
    assert.equal(closed.status, "superseded");
    assert.equal(current.perspective?.status === "running", false);
  }
});

test("reflection titles bold only the label and the exact mode ID", async () => {
  for (const mode of ["focus", "probe", "pace"]) {
    const guard = new JevGuard({ evaluate: async () => ({ ...quiet, [mode]: 0.95 }) });
    const token = await start(guard);
    const result = await guard.checkpoint(checkpoint(token));
    const title = result.reflection.split("\n")[0];
    assert.deepEqual([...title.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]), ["Jev reflection", mode]);
    assert.ok(title.endsWith("?"));
  }
});
