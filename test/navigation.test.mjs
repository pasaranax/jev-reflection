import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { JevGuard, INTERVAL_MS, evaluateWithJev } from "../src/guard.mjs";

const quiet = { focus: 0.1, cause: 0.1, probe: 0.1, pace: 0.1, perspective: 0.1, reviewableWork: false, optionId: "none", evidenceId: "none" };
const event = { sessionId: "session", turnId: "turn" };
async function start(guard, overrides = {}) {
  const output = await guard.handle({ ...event, event: "turn_start", prompt: "Import and verify the data.", ...overrides });
  assert.equal(output.hookSpecificOutput?.hookEventName, "UserPromptSubmit");
  const token = output.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)?.[1];
  assert.ok(token, "The agent must receive a usable checkpoint token");
  return token;
}
async function observe(guard, text = "Read 12 source rows", overrides = {}) {
  return guard.handle({ ...event, event: "tool_end", toolName: "exec_command", toolInput: { cmd: "read source" }, toolResponse: text, ...overrides });
}
const criteria = [
  { id: "read", description: "Read source data" },
  { id: "convert", description: "Convert data" },
  { id: "save", description: "Save verified output" },
];
function checkpoint(turnToken, overrides = {}) {
  return { turnToken, event: "plan", goal: "Import and verify the data.", assumptions: [], options: [], criteria, evidenceIds: [], ...overrides };
}

test("checkpoint reminders wait thirty minutes and reset after an accepted checkpoint", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, intervalMs: 24 * 60 * 60_000, evaluate: async () => quiet });
  const token = await start(guard);
  for (const [minutes, expected] of [[10, false], [29.99, false], [30, true], [59.99, false], [60, true]]) {
    now = minutes * 60_000;
    const context = (await observe(guard)).hookSpecificOutput.additionalContext;
    assert.equal(context.includes("update jev_checkpoint"), expected, `Reminder at ${minutes} minutes`);
  }
  now = 75 * 60_000;
  await guard.checkpoint(checkpoint(token));
  now = 90 * 60_000;
  assert.doesNotMatch((await observe(guard)).hookSpecificOutput.additionalContext, /update jev_checkpoint/);
  now = 105 * 60_000;
  assert.match((await observe(guard)).hookSpecificOutput.additionalContext, /update jev_checkpoint/);
});

test("a decision checkpoint yields an advisory probe with an observed evidence pointer", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return { ...quiet, probe: 0.94, optionId: "B", evidenceId: "a1" }; } });
  const token = await start(guard);
  await observe(guard, "Endpoint availability has not been tested");
  const result = await guard.checkpoint(checkpoint(token, { event: "decision", options: [
    { id: "A", action: "Implement importer", prerequisites: "Endpoint available", expectedObservation: "Importer runs", evidenceIds: [] },
    { id: "B", action: "Send one sample request", prerequisites: "Credentials loaded", expectedObservation: "Endpoint accepts or rejects sample", evidenceIds: ["a1"] },
  ] }));
  assert.match(result.reflection, /What should I \*\*probe\*\* first\?/);
  assert.match(result.reflection, /B/);
  assert.match(result.reflection, /a1/);
  assert.doesNotMatch(JSON.stringify(result), /Endpoint availability has not been tested|Send one sample request/);
  assert.match(result.reflection, /decide|decision/i);
  assert.equal(captured.checkpoint.options[1].action, "Send one sample request");
  assert.equal(captured.recent_actions[0].id, "a1");
});

test("criteria alone do not produce a progress estimate", async () => {
  const guard = new JevGuard({ evaluate: async () => quiet });
  const token = await start(guard);
  await observe(guard);
  const result = await guard.checkpoint(checkpoint(token));
  assert.equal(result.status, "checked");
  assert.equal(Object.hasOwn(result.signals, "route"), false);
  assert.equal(Object.hasOwn(result, "progress"), false);
  assert.equal(Object.hasOwn(result, "hud"), false);
});

test("Jev estimates reach checkpoints as a ten-circle HUD, including regressions and plan changes", async () => {
  let now = 0;
  let percent = 40;
  const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, progressPercent: percent }) });
  const token = await start(guard);
  await observe(guard);
  const run = async (overrides = {}) => {
    now += 15 * 60_000;
    return guard.checkpoint(checkpoint(token, { event: "milestone", outcome: `Observation at ${now}`, ...overrides }));
  };
  assert.equal((await run()).hud, "●●●●○○○○○○ — ~40% of the plan completed.");
  assert.equal((await run()).hud, undefined, "Do not repeat an unchanged estimate");
  percent = 60;
  assert.equal((await run()).hud, "●●●●●●○○○○ — ~60% of the plan completed.");
  percent = 30;
  assert.equal((await run()).hud, "●●●○○○○○○○ — ~30% of the plan completed. Estimate revised.");
  assert.equal((await run({ goal: "Import another dataset." })).hud, undefined, "A reworded plan does not repeat the same HUD");
  percent = 100;
  assert.equal((await run()).hud, "●●●●●●●●●● — ~100% of the plan completed.");
  percent = 0;
  assert.equal((await run()).hud, "○○○○○○○○○○ — ~0% of the plan completed. Estimate revised.");
});

test("HUD explains scope growth once and distinguishes it from a revised estimate", async () => {
  let now = 0, percent = 60, scopeChange = "none";
  let captured;
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { captured = state; return { ...quiet, progressPercent: percent, scopeChange }; } });
  const token = await start(guard);
  const run = async () => {
    now += 15 * 60_000;
    return guard.checkpoint(checkpoint(token, { outcome: `At ${now}` }));
  };
  assert.match((await run()).hud, /~60% of the plan completed\.$/);
  percent = 40; scopeChange = "added_2";
  assert.match((await run()).hud, /~40%.*Scope expanded \(\+2 plan items\)\.$/);
  assert.equal(captured.progress_run.last_report.percent, 60);
  scopeChange = "none";
  assert.equal((await run()).hud, undefined, "Do not repeat the HUD just to remove its scope note");
  percent = 30;
  assert.match((await run()).hud, /Estimate revised\.$/);
  scopeChange = "expanded";
  assert.match((await run()).hud, /~30%.*Scope expanded\.$/, "Growth is visible even if completion percentage stays the same");
  scopeChange = "added_1";
  assert.match((await run()).hud, /Scope expanded \(\+1 plan item\)\.$/);
});

test("scope comparison advances only when its HUD is delivered and survives automatic continuation", async () => {
  let now = 0, percent = 60;
  const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, progressPercent: percent, scopeChange: "none" }) });
  const token = await start(guard);
  now = 15 * 60_000;
  await guard.checkpoint(checkpoint(token));
  const state = guard.turns.get("session:turn");
  const original = state.progressRun.last_report;
  now = 30 * 60_000; percent = 40;
  await observe(guard);
  await setImmediate();
  assert.equal(state.progressRun.last_report, original, "An undelivered background result is not the comparison baseline");
  await start(guard, { prompt: "Also validate another format." });
  assert.equal(state.progressRun.last_report, original, "Steering discards the pending HUD, not the last shown scope");
  now = 45 * 60_000;
  await observe(guard);
  await setImmediate();
  const delivered = await observe(guard);
  assert.match(delivered.hookSpecificOutput.additionalContext, /~40%.*Estimate revised/);
  assert.equal(state.progressRun.last_report.percent, 40);
  await start(guard, { turnId: "automatic", prompt: '<codex_internal_context source="goal">Continue.</codex_internal_context>' });
  assert.equal(guard.turns.get("session:automatic").progressRun.last_report.percent, 40);
  await start(guard, { turnId: "fresh", prompt: "Start a different task." });
  assert.equal(guard.turns.get("session:fresh").progressRun.last_report, undefined);
});

test("scope comparison uses the existing collaborative request only after a delivered HUD", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
      q.type === "noul" ? { noul: 0.1 } : { choice: key === "scope_change" ? "added_2" : key === "plan_progress" ? "p40" : "none" },
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  const state = { estimate_progress: true, recent_actions: [], progress_run: { launch_directive: "Import data" } };
  await evaluateWithJev(state, { apiKey: "fake-key" });
  assert.ok(requests.every((request) => request.questions.scope_change === undefined));
  requests.length = 0;
  state.progress_run.last_report = { percent: 60, goal: "Import data", criteria, clarifications: [] };
  const result = await evaluateWithJev(state, { apiKey: "fake-key" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].questions.scope_change, undefined);
  assert.equal(requests[1].questions.scope_change.type, "choice");
  assert.equal(result.scopeChange, "added_2");
});

test("scheduled progress is delivered through a hook without a reflection signal", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...quiet, progressPercent: 40 }) });
  await start(guard);
  now = 15 * 60_000;
  await observe(guard);
  await setImmediate();
  const delivered = await observe(guard);
  assert.match(delivered.hookSpecificOutput.additionalContext, /●●●●○○○○○○ — ~40% of the plan completed\./);
  assert.match(delivered.hookSpecificOutput.additionalContext, /verbatim/);
  assert.equal(delivered.systemMessage, undefined);
});

test("one rough progress question uses the existing collaborative request", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
      q.type === "noul" ? { noul: 0.1 } : { choice: key === "plan_progress" ? "p40" : "none" },
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  const progressRun = { launch_directive: "Import both datasets", initial_plan: { goal: "Import data", criteria }, milestones: [] };
  const result = await evaluateWithJev({ estimate_progress: true, progress_run: progressRun, recent_actions: [], checkpoint: { goal: "Import data", criteria, options: [] } }, { apiKey: "fake-key" });
  assert.equal(result.progressPercent, 40);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].questions.plan_progress, undefined);
  assert.equal(requests[1].questions.plan_progress.type, "choice");
  assert.deepEqual(requests[1].state.progress_run, progressRun);
  assert.equal(requests[0].state.progress_run, undefined, "The independent reflection pass does not need progress telemetry");
  assert.deepEqual(Object.keys(requests[1].questions).filter((key) => /^(completed_|proof_|coverage_)/.test(key)), []);
});

test("progress waits fifteen minutes across checkpoints, reworded plans and new turns in the same chat", async () => {
  let now = 0;
  const estimates = [];
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => {
    estimates.push({ at: now, requested: state.estimate_progress });
    return { ...quiet, cause: 0.9, progressPercent: 40 };
  } });
  let token = await start(guard);
  const run = (goal) => guard.checkpoint(checkpoint(token, { goal: goal ?? "Import and verify the data.", outcome: `At ${now}` }));
  assert.equal((await run()).hud, undefined, "No estimate on the initial checkpoint");
  now = 14 * 60_000;
  assert.equal((await run()).hud, undefined);
  now = 15 * 60_000;
  assert.match((await run()).hud, /~40%/);
  now += 31_000;
  const changed = await run("Import a different dataset.");
  assert.equal(changed.hud, undefined, "A changed plan cannot bypass the time gate");
  assert.match(changed.reflection, /cause/, "Reflection is still evaluated between HUD estimates");
  now += 31_000;
  token = await start(guard, { turnId: "next", prompt: "Continue with the corrected dataset." });
  assert.equal((await run()).hud, undefined, "A new directive cannot bypass the chat-wide gate");
  now = 29 * 60_000;
  assert.equal((await run()).hud, undefined);
  now = 30 * 60_000;
  assert.match((await run()).hud, /~40%/);
  assert.deepEqual(estimates.filter((item) => item.requested).map((item) => item.at), [15 * 60_000, 30 * 60_000]);
});

test("five-minute checks keep reflecting but request progress only every fifteen minutes", async () => {
  let now = 0;
  const estimates = [];
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => {
    estimates.push(state.estimate_progress);
    return { ...quiet, probe: 0.9, progressPercent: 40 };
  } });
  await start(guard);
  for (const minutes of [5, 10, 15, 20, 25, 30]) {
    now = minutes * 60_000;
    await observe(guard);
    await setImmediate();
    const delivered = await observe(guard);
    const text = delivered.hookSpecificOutput.additionalContext;
    assert.match(text, /probe/);
    assert.equal(text.includes("plan completed"), minutes === 15, `HUD at ${minutes} minutes`);
  }
  assert.deepEqual(estimates, [false, false, true, false, false, true]);
});

test("Jev receives no progress question between progress intervals", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
      q.type === "noul" ? { noul: 0.1 } : { choice: "none" },
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  const result = await evaluateWithJev({ estimate_progress: false, progress_run: { launch_directive: "Long run plan" }, recent_actions: [], checkpoint: null }, { apiKey: "fake-key" });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !Object.hasOwn(request.questions, "plan_progress")));
  assert.ok(requests.every((request) => !Object.hasOwn(request.state, "progress_run")));
  assert.equal(result.progressPercent, undefined);
});

test("delayed hook delivery starts the next fifteen-minute display interval", async () => {
  let now = 0;
  let percent = 40;
  const requests = [];
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => {
    requests.push(state.estimate_progress);
    return { ...quiet, progressPercent: percent };
  } });
  await start(guard);
  now = 15 * 60_000;
  await observe(guard);
  await setImmediate();
  now = 22 * 60_000;
  assert.match((await observe(guard)).hookSpecificOutput.additionalContext, /~40%/);
  percent = 60;
  now = 30 * 60_000;
  await observe(guard);
  await setImmediate();
  assert.doesNotMatch((await observe(guard)).hookSpecificOutput.additionalContext, /plan completed/);
  now = 37 * 60_000;
  await observe(guard);
  await setImmediate();
  assert.match((await observe(guard)).hookSpecificOutput.additionalContext, /~60%/);
  assert.deepEqual(requests, [true, false, true]);
});

test("no-basis estimates do not cause progress polling on subsequent checkpoints", async () => {
  let now = 0;
  const requests = [];
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => {
    requests.push(state.estimate_progress);
    return quiet;
  } });
  const token = await start(guard);
  for (const minutes of [15, 16, 20, 30]) {
    now = minutes * 60_000;
    assert.equal((await guard.checkpoint(checkpoint(token, { outcome: `At ${minutes}` }))).hud, undefined);
  }
  assert.deepEqual(requests, [true, false, false, true]);
});

test("both Jev views see recent agent status without ranking telemetry or per-criterion scoring", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
      q.type === "noul" ? { noul: 0.1 } : { choice: "none" },
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  await evaluateWithJev({
    current_user_directive: "Implement image inspection.",
    user_message_history: ["Implement image inspection."],
    conversation_timeline: [{ at: "2026-10-04T11:32:00Z", role: "assistant", text: "SDK transport checked; implementing the existing recognizer path." }],
    recent_actions: [{ id: "a1", tool: "read", input: "SDK converter", output: "Image tool outputs are unsupported." }],
    checkpoint: { options: [{ id: "B", action: "CHECKPOINT_PREFERENCE", prerequisites: "", expectedObservation: "", evidenceIds: [] }], criteria },
  }, { apiKey: "fake-key" });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.state.conversation_timeline.at(-1).text, "SDK transport checked; implementing the existing recognizer path.");
    assert.equal(request.state.recent_actions.at(-1).output, "Image tool outputs are unsupported.");
    assert.equal(Object.hasOwn(request.questions, "route"), false);
    assert.deepEqual(Object.keys(request.questions).filter((key) => /^(completed_|proof_|coverage_)/.test(key)), []);
  }
  assert.equal(JSON.stringify(requests[0].state).includes("CHECKPOINT_PREFERENCE"), false);
  assert.equal(JSON.stringify(requests[1].state).includes("CHECKPOINT_PREFERENCE"), true);
});

test("cause reflection reaches the agent with evidence at the threshold and stays quiet below it", async () => {
  for (const [cause, expected] of [[0.79, false], [0.8, true]]) {
    const guard = new JevGuard({ evaluate: async () => ({ ...quiet, cause, evidenceId: "a1" }) });
    const token = await start(guard, { prompt: "Prevent the same setup failure for all plugin users." });
    await observe(guard, "Only the developer's local settings were changed.");
    const result = await guard.checkpoint(checkpoint(token, { criteria: [] }));
    assert.equal(result.status, "checked");
    assert.equal(result.signals.cause, cause);
    assert.equal(Boolean(result.reflection), expected);
    if (expected) {
      assert.match(result.reflection, /^🔍 \*\*Jev reflection\*\* — Am I fixing the \*\*cause\*\* or just the symptom\?/);
      assert.match(result.reflection, /observation a1/);
      assert.doesNotMatch(result.reflection, /Only the developer's local settings/);
    }
  }
});

test("cause is evaluated in both existing Jev requests and independent evidence can challenge the agent", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const independent = !body.state.checkpoint;
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key,
      question.type === "noul" ? { noul: key === "cause" && independent ? 0.93 : 0.1 }
        : { choice: key === "evidence" && independent ? "a1" : "none" }
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  const result = await evaluateWithJev({
    current_user_directive: "Prevent corrupted exports from recurring.",
    user_message_history: ["Prevent corrupted exports from recurring."],
    recent_actions: [{ id: "a1", tool: "apply_patch", input: "Repair one generated export", output: "Export repaired; generator unchanged" }],
    checkpoint: { goal: "The problem is fixed", options: [], criteria: [] },
  }, { apiKey: "fake-key" });
  assert.equal(requests.length, 2, "Adding cause must not add API requests");
  assert.ok(requests.every((request) => request.questions.cause?.type === "noul"));
  assert.equal(result.cause, 0.93);
  assert.equal(result.evidenceId, "a1");
});



test("rejects a fabricated observation, duplicate criteria, and agent-supplied option ratings", async () => {
  let calls = 0;
  const guard = new JevGuard({ evaluate: async () => { calls++; return quiet; } });
  const token = await start(guard);
  for (const change of [
    { evidenceIds: ["a999"] },
    { criteria: [criteria[0], criteria[0]] },
    { options: [{ id: "A", action: "Read", prerequisites: "", expectedObservation: "Rows", evidenceIds: [], preferred: true }] },
  ]) await assert.rejects(() => guard.checkpoint(checkpoint(token, change)), TypeError);
  assert.equal(calls, 0);
});

test("checkpoints are isolated by turn token and a new turn invalidates the old token", async () => {
  let calls = 0;
  const guard = new JevGuard({ evaluate: async () => { calls++; return quiet; } });
  const token = await start(guard);
  const other = await start(guard, { sessionId: "other", turnId: "other" });
  assert.notEqual(token, other);
  await start(guard, { turnId: "next" });
  const stale = await guard.checkpoint(checkpoint(token));
  assert.equal(stale.status, "superseded");
  assert.equal(JSON.stringify(stale).includes(other), false, "Never redirect a stale call to another chat");
  assert.equal(calls, 0);
});

test("after state loss the next hook restores a token without recording Jev as evidence", async () => {
  const before = new JevGuard({ evaluate: async () => quiet });
  const oldToken = await start(before);
  const guard = new JevGuard({ evaluate: async () => quiet });
  assert.equal((await guard.checkpoint(checkpoint(oldToken))).status, "superseded");
  const output = await observe(guard, { status: "superseded" }, { toolName: "jev_checkpoint" });
  const token = output.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)?.[1];
  assert.ok(token);
  assert.notEqual(token, oldToken);
  assert.equal([...guard.turns.values()][0].actions.length, 0);
  assert.equal((await guard.checkpoint(checkpoint(token))).status, "checked");
});

test("a regular tool hook supplies a token when turn-start state was lost", async () => {
  const guard = new JevGuard({ evaluate: async () => quiet });
  const output = await observe(guard);
  const context = output.hookSpecificOutput.additionalContext;
  const token = context.match(/turnToken="([^"]+)"/)?.[1];
  assert.ok(token);
  assert.match(context, /a1/);
  assert.equal((await guard.checkpoint(checkpoint(token, { evidenceIds: ["a1"] }))).status, "checked");
  assert.doesNotMatch((await observe(guard)).hookSpecificOutput.additionalContext, /turnToken=/, "Recovery must not repeat on every tool");
});

test("scheduled evaluation runs in the background and drops a result after user steering", async () => {
  let now = 0;
  let resolve;
  const guard = new JevGuard({ now: () => now, evaluate: () => new Promise((r) => { resolve = r; }) });
  await start(guard);
  now = INTERVAL_MS;
  assert.equal((await observe(guard)).systemMessage, undefined);
  await setImmediate();
  assert.equal(typeof resolve, "function");
  await start(guard, { prompt: "Change direction. Only inspect the schema." });
  resolve({ ...quiet, focus: 0.99 });
  await setImmediate();
  const output = await observe(guard);
  assert.equal(output.systemMessage, undefined);
});

test("one pending evaluation coalesces observations and a ready result appears on the next tool completion", async () => {
  let now = 0;
  let resolve;
  let calls = 0;
  const guard = new JevGuard({ now: () => now, evaluate: () => { calls++; return new Promise((r) => { resolve = r; }); } });
  await start(guard);
  now = INTERVAL_MS;
  await observe(guard);
  await setImmediate();
  now += INTERVAL_MS;
  await observe(guard);
  assert.equal(calls, 1);
  resolve({ ...quiet, pace: 0.92 });
  await setImmediate();
  const output = await observe(guard);
  assert.match(output.systemMessage, /Is my \*\*pace\*\* appropriate for this task\?/);
  assert.match(output.hookSpecificOutput.additionalContext, /waiting|poll/i);
});

test("repeated identical checkpoints reuse the result instead of spending another evaluation", async () => {
  let calls = 0;
  const guard = new JevGuard({ evaluate: async () => { calls++; return quiet; } });
  const token = await start(guard);
  await guard.checkpoint(checkpoint(token));
  const second = await guard.checkpoint(checkpoint(token));
  assert.equal(calls, 1);
  assert.equal(second.status, "unchanged");
});

test("model-selected fabricated evidence cannot become a navigation instruction", async () => {
  const guard = new JevGuard({ evaluate: async () => ({ ...quiet, pace: 0.95, optionId: "invented", evidenceId: "a999" }) });
  const token = await start(guard);
  const result = await guard.checkpoint(checkpoint(token));
  assert.match(result.status, /unavailable/);
  assert.equal(result.progress, undefined);
  assert.equal(result.reflection, undefined);
});

test("the independent Jev pass excludes checkpoint preferences but sees agent status", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key,
      question.type === "noul" ? { noul: 0.1 } : { choice: "none" }
    ]));
    return new Response(JSON.stringify({ answers }));
  });
  const result = await evaluateWithJev({
    current_user_directive: "Import data", user_message_history: ["Import data"],
    conversation_timeline: [{ role: "assistant", text: "MY_FAVORITE_OPTION" }, { role: "user", text: "Keep it simple" }],
    recent_actions: [{ id: "a1", tool: "read", input: "", output: "API supports bulk requests" }],
    checkpoint: { options: [{ id: "B", action: "MY_FAVORITE_OPTION", prerequisites: "", expectedObservation: "", evidenceIds: [] }], criteria: [] },
  }, { apiKey: "fake-key" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].state.checkpoint, undefined);
  assert.equal(requests[0].state.conversation_timeline[0].text, "MY_FAVORITE_OPTION");
  assert.equal(JSON.stringify(requests[1].state).includes("MY_FAVORITE_OPTION"), true);
  assert.equal(result.focus, 0.1);
});

test("wrapped checkpoint calls do not feed agent telemetry back as tool evidence", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  await observe(guard, "API supports bulk requests");
  const output = await observe(guard, { reflection: "CHECKPOINT_MARKER" }, {
    toolName: "functions.exec",
    toolInput: { code: 'await tools.mcp__jev_reflection__jev_checkpoint({ goal: "CHECKPOINT_MARKER" });' },
  });
  assert.deepEqual(output, {});
  await guard.checkpoint(checkpoint(token));
  assert.equal(captured.recent_actions.length, 1);
  assert.equal(JSON.stringify(captured.recent_actions).includes("CHECKPOINT_MARKER"), false);
});

test("yielded checkpoint wrappers exclude their wait continuations but keep unrelated waits", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  await observe(guard, "Script running with cell ID 17", {
    toolName: "functions.exec", toolInput: { code: "await tools.mcp__jev_reflection__jev_checkpoint(input)" },
  });
  for (const response of ["Script running with cell ID 17", { reflection: "CHECKPOINT_MARKER" }]) {
    assert.deepEqual(await observe(guard, response, {
      toolName: "functions.wait", toolInput: { cell_id: "17" },
    }), {});
  }
  await observe(guard, "Actual job completed", { toolName: "functions.wait", toolInput: { cell_id: "18" } });
  await guard.checkpoint(checkpoint(token));
  assert.equal(captured.recent_actions.length, 1);
  assert.match(captured.recent_actions[0].output, /Actual job completed/);
});

test("changed checkpoints during cooldown queue the latest version and are evaluated on the next eligible observation", async () => {
  let now = 0;
  const seen = [];
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { seen.push(state.checkpoint); return quiet; } });
  const token = await start(guard);
  await guard.checkpoint(checkpoint(token));
  now = 1_000;
  const queued = await guard.checkpoint(checkpoint(token, { event: "decision", outcome: "New API limit found" }));
  assert.equal(queued.status, "queued");
  assert.equal(seen.length, 1);
  now = 31_000;
  await observe(guard, "API limit confirmed");
  await setImmediate();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].outcome, "New API limit found");
});





test("checkpoint references stay usable beyond the recent window", async () => {
  let now = 0;
  let captured;
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  await observe(guard, "Early observation");
  await observe(guard, "Assumption evidence");
  await observe(guard, "Option evidence");
  const claims = {
    evidenceIds: ["a1"],
    assumptions: [{ id: "dependency", statement: "Endpoint exists", dependentWork: "Importer", evidenceIds: ["a2"] }],
    options: [{ id: "sample", action: "Try one row", prerequisites: "Endpoint", expectedObservation: "Accepted row", evidenceIds: ["a3"] }],
  };
  await guard.checkpoint(checkpoint(token, claims));
  for (let i = 0; i < 32; i++) await observe(guard, `Later observation ${i}`);
  now = 31_000;
  const result = await guard.checkpoint(checkpoint(token, { ...claims, event: "evidence" }));
  assert.equal(result.status, "checked");
  for (const id of ["a1", "a2", "a3"]) assert.ok(captured.recent_actions.some((item) => item.id === id));
  assert.equal(captured.recent_actions.length, 19);
  now += 31_000;
  await guard.checkpoint(checkpoint(token));
  assert.equal(captured.recent_actions.length, 16, "Removed references must not accumulate forever");
});

test("previously unreferenced observations survive the recent context window", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  for (let i = 0; i < 20; i++) await observe(guard);
  const result = await guard.checkpoint(checkpoint(token, { evidenceIds: ["a1", "a20"] }));
  assert.equal(result.status, "checked");
  assert.equal(captured.recent_actions.length, 17);
  assert.ok(captured.recent_actions.some((item) => item.id === "a1"));
  assert.equal(result.observations, undefined);
  await assert.rejects(() => guard.checkpoint(checkpoint(token, { evidenceIds: ["a01"] })), TypeError);
});

test("an unavailable issued reference does not discard telemetry or become proof", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  for (let i = 0; i < 4100; i++) await observe(guard);
  const result = await guard.checkpoint(checkpoint(token, {
    evidenceIds: ["a1", "a4100"], outcome: "The plan still matters.",
    assumptions: [{ id: "assumption", statement: "Claim", dependentWork: "Next step", evidenceIds: ["a1"] }],
  }));
  assert.equal(result.status, "checked");
  assert.equal(captured.checkpoint.outcome, "The plan still matters.");
  assert.deepEqual(captured.unavailable_evidence_ids, ["a1"]);
  assert.deepEqual(captured.checkpoint.evidenceIds, ["a4100"]);
  assert.deepEqual(captured.checkpoint.assumptions[0].evidenceIds, []);
  assert.equal(result.observations, undefined);
  await assert.rejects(() => guard.checkpoint(checkpoint(token, { evidenceIds: ["a4101"] })), TypeError);
});

test("progress retains the launch plan through steering and automatic goal continuation", async () => {
  let now = 0;
  let captured;
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard, { prompt: "Import and verify two datasets." });
  await observe(guard);
  await guard.checkpoint(checkpoint(token, { evidenceIds: ["a1"], outcome: "First dataset imported." }));
  now += 31_000;
  await start(guard, { prompt: "Keep the original column names." });
  const turn = guard.turns.get("session:turn");
  assert.equal(turn.checkpoint.outcome, "First dataset imported.");
  assert.ok(turn.checkpointEvidence.some((item) => item.id === "a1"));
  await guard.checkpoint(checkpoint(token, { outcome: "Checking the second dataset." }));
  assert.equal(captured.progress_run.launch_directive, "Import and verify two datasets.");
  assert.ok(captured.progress_run.clarifications.includes("Keep the original column names."));
  const initialPlan = captured.progress_run.initial_plan;
  now += 31_000;
  const continuation = await start(guard, { turnId: "automatic", prompt: '<codex_internal_context source="goal">\n<objective>Import and verify two datasets.</objective>\n</codex_internal_context>' });
  await guard.checkpoint(checkpoint(continuation, { outcome: "Continue verification." }));
  assert.equal(captured.progress_run.launch_directive, "Import and verify two datasets.");
  assert.deepEqual(captured.progress_run.initial_plan, initialPlan);
  assert.ok(captured.progress_run.milestones.some((item) => item.outcome === "First dataset imported."));
  const fresh = await start(guard, { turnId: "fresh", prompt: "Build a chart instead." });
  await guard.checkpoint(checkpoint(fresh, { goal: "Build a chart." }));
  assert.equal(captured.progress_run.launch_directive, "Build a chart instead.");
  assert.equal(captured.progress_run.initial_plan.goal, "Build a chart.");
  assert.deepEqual(captured.progress_run.clarifications, []);
});

test("checkpoint secrets are redacted before model evaluation", async () => {
  let captured;
  const guard = new JevGuard({ evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  await guard.checkpoint(checkpoint(token, { goal: "Use api_key=secret-checkpoint-value", outcome: "Authorization: Bearer hidden-value" }));
  assert.doesNotMatch(JSON.stringify(captured), /secret-checkpoint-value|hidden-value/);
});

test("checked, unchanged and queued checkpoints do not echo observation history to the agent", async () => {
  let captured;
  const guard = new JevGuard({ now: () => 0, evaluate: async (state) => { captured = state; return quiet; } });
  const token = await start(guard);
  for (let i = 0; i < 16; i++) await observe(guard, `Repeated tool payload ${i}: ${"x".repeat(200)}`);
  const checked = await guard.checkpoint(checkpoint(token));
  const unchanged = await guard.checkpoint(checkpoint(token));
  const queued = await guard.checkpoint(checkpoint(token, { event: "evidence" }));
  assert.deepEqual([checked.status, unchanged.status, queued.status], ["checked", "unchanged", "queued"]);
  for (const response of [checked, unchanged, queued]) {
    assert.equal(response.observations, undefined);
    assert.doesNotMatch(JSON.stringify(response), /Repeated tool payload/);
  }
  assert.equal(captured.recent_actions.length, 16, "Jev still receives the working observations internally");
  assert.match(captured.recent_actions[0].output, /Repeated tool payload/);
});

test("a reserved none option cannot replace Jev's abstention choice", async () => {
  const guard = new JevGuard({ evaluate: async () => quiet });
  const token = await start(guard);
  await assert.rejects(() => guard.checkpoint(checkpoint(token, { options: [{ id: "none", action: "Build everything", prerequisites: "", expectedObservation: "", evidenceIds: [] }] })), TypeError);
});

test("checkpoint diagnostics name the correction without echoing untrusted values", async () => {
  const { validateCheckpoint } = await import("../src/navigator.mjs");
  const base = checkpoint("token");
  const missing = { ...base }; delete missing.assumptions; delete missing.options;
  assert.throws(() => validateCheckpoint(missing), /missing required fields: assumptions, options/);
  assert.throws(() => validateCheckpoint({ ...base, evidenceIds: Array.from({ length: 24 }, (_, i) => `a${i}`) }), /evidenceIds: expected at most 16 items; received 24/);
  assert.throws(() => validateCheckpoint({ ...base, options: [{ id: "test", action: "test", prerequisites: [], expectedObservation: "", evidenceIds: [] }] }), /options\[0\].prerequisites: expected a string; received array/);
  assert.throws(() => validateCheckpoint({ ...base, criteria: [{ id: "x", description: "ok" }, { id: "x", description: "ok" }] }), /criteria: item IDs must be unique/);
  assert.throws(() => validateCheckpoint({ ...base, evidenceIds: ["a1", "a1"] }), /evidenceIds: items must be unique/);
  assert.throws(() => validateCheckpoint({ ...base, outcome: "x".repeat(801) }), /outcome: expected at most 800 characters; received 801/);
  for (const invalid of [{ ...base, ["secret-key-name"]: "secret-value" }, { ...base, options: ["secret-value"] }, { ...base, event: "secret-value" }]) {
    assert.throws(() => validateCheckpoint(invalid), (error) => !/secret-key-name|secret-value/.test(error.message));
  }
  // Errors must not mutate state or consume the token: a corrected retry works.
  const guard = new JevGuard({ evaluate: async () => quiet });
  const token = await start(guard);
  await assert.rejects(guard.checkpoint({ ...base, turnToken: token, evidenceIds: Array(17).fill("a1") }), /at most 16/);
  assert.equal((await guard.checkpoint(checkpoint(token))).status, "checked");
});
