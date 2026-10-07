import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateWithJev, INTERVAL_MS, JevGuard } from "../src/guard.mjs";

const lowScores = {
  focus: 0.1, cause: 0.1, probe: 0.1, pace: 0.1, perspective: 0.1, reviewableWork: false,
  optionId: "none", evidenceId: "none",
};

test("does not call Jev before the five-minute boundary", async () => {
  let now = 0;
  let calls = 0;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async () => {
      calls += 1;
      return lowScores;
    },
  });

  await startTurn(guard);
  now = INTERVAL_MS - 1;
  const output = await toolEnd(guard);

  assert.equal(output.systemMessage, undefined);
  assert.equal(calls, 0);
});

test("checks once per interval and stays quiet below the threshold", async () => {
  let now = 0;
  let calls = 0;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async () => {
      calls += 1;
      return lowScores;
    },
  });

  await startTurn(guard);
  now = INTERVAL_MS;
  assert.equal((await toolEnd(guard)).systemMessage, undefined);
  now += 1_000;
  assert.equal((await toolEnd(guard)).systemMessage, undefined);
  assert.equal(calls, 1);
});

test("keeps sixteen actions and both ends of long fields", async () => {
  let now = 0;
  let capturedState;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => {
      capturedState = state;
      return lowScores;
    },
  });

  await startTurn(guard);
  for (let index = 1; index <= 20; index += 1) {
    now = index * 1_000;
    await guard.handle({
      event: "tool_end",
      sessionId: "session",
      turnId: "turn",
      toolName: `tool-${index}`,
      toolInput: `HEAD-${index}-${"x".repeat(2_000)}-TAIL-${index}`,
      toolResponse: `RESULT-${index}`,
    });
  }

  now = INTERVAL_MS;
  await toolEnd(guard);

  assert.equal(capturedState.recent_actions.length, 16);
  assert.equal(capturedState.recent_actions[0].tool, "tool-6");
  assert.equal(capturedState.recent_actions.at(-2).tool, "tool-20");
  assert.match(capturedState.recent_actions.at(-2).input, /^HEAD-20-/);
  assert.match(capturedState.recent_actions.at(-2).input, /-TAIL-20$/);
  assert.match(capturedState.recent_actions.at(-2).input, /\[middle truncated\]/);
});

test("gives Jev the first and last seven user messages with the newest directive", async () => {
  let now = 0;
  let capturedState;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => {
      capturedState = state;
      return lowScores;
    },
  });

  for (let index = 1; index <= 10; index += 1) {
    now = index * 1_000;
    await startTurn(guard, {
      turnId: `turn-${index}`,
      prompt: `user-message-${index}`,
    });
  }

  now += INTERVAL_MS;
  await toolEnd(guard, { turnId: "turn-10" });

  assert.equal(capturedState.current_user_directive, "user-message-10");
  assert.deepEqual(capturedState.user_message_history, [
    "user-message-1",
    "user-message-4",
    "user-message-5",
    "user-message-6",
    "user-message-7",
    "user-message-8",
    "user-message-9",
    "user-message-10",
  ]);
});

test("a new user message in the active turn keeps the observed actions", async () => {
  let now = 0;
  let capturedState;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => {
      capturedState = state;
      return lowScores;
    },
  });

  await startTurn(guard, { prompt: "Start with approach A." });
  now = 1_000;
  await toolEnd(guard, { toolName: "before-steering" });
  now = 2_000;
  await startTurn(guard, { prompt: "Switch to approach B." });
  now = INTERVAL_MS + 2_000;
  await toolEnd(guard, { toolName: "after-steering" });

  assert.equal(capturedState.current_user_directive, "Switch to approach B.");
  assert.deepEqual(
    capturedState.recent_actions.map((action) => action.tool),
    ["before-steering", "after-steering"],
  );
});

test("has no progress message for silent checks", async () => {
  const hooks = JSON.parse(
    await readFile(new URL("../hooks/hooks.json", import.meta.url), "utf8"),
  );
  const postToolHook = hooks.hooks.PostToolUse[0].hooks[0];

  assert.equal(Object.hasOwn(postToolHook, "statusMessage"), false);
});

test("forwards the transcript path to the hook endpoint", async () => {
  const hooks = JSON.parse(
    await readFile(new URL("../hooks/hooks.json", import.meta.url), "utf8"),
  );
  const postToolInput = hooks.hooks.PostToolUse[0].hooks[0].input;

  assert.equal(postToolInput.transcriptPath, "${transcript_path}");
});

test("gives Jev recent timestamped user and assistant messages from the transcript", async () => {
  let now = Date.parse("2026-09-18T12:15:00.000Z");
  let capturedState;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => {
      capturedState = state;
      return lowScores;
    },
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-reflection-transcript-"));
  const transcriptPath = path.join(directory, "rollout.jsonl");
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        timestamp: "2026-09-18T12:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "Warm-up normally takes 10 minutes." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-18T12:12:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "TYPESAFE_API_KEY=must-not-leak" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-18T12:14:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Do not include developer messages." }],
        },
      }),
      "unfinished-json",
    ].join("\n"),
  );

  await startTurn(guard);
  now += INTERVAL_MS;
  await toolEnd(guard, { transcriptPath });

  assert.equal(capturedState.checked_at, "2026-09-18T12:20:00.000Z");
  assert.deepEqual(capturedState.conversation_timeline, [
    {
      at: "2026-09-18T12:00:00.000Z",
      role: "assistant",
      text: "Warm-up normally takes 10 minutes.",
    },
    {
      at: "2026-09-18T12:12:00.000Z",
      role: "user",
      text: "TYPESAFE_API_KEY=[redacted]",
    },
  ]);
});

test("includes bounded attributed subagent reports without promoting them to user directives", async () => {
  let now = 0, captured;
  const guard = new JevGuard({ now: () => now, evaluate: async (state) => { captured = state; return lowScores; } });
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-review-transcript-"));
  const transcriptPath = path.join(directory, "rollout.jsonl");
  const record = (payload) => JSON.stringify({ timestamp: "2026-10-07T12:00:00Z", type: "response_item", payload });
  await writeFile(transcriptPath, [
    ...Array.from({ length: 18 }, (_, i) => record({ type: "message", role: "assistant", content: [{ type: "output_text", text: `Earlier status ${i}` }] })),
    record({ type: "agent_message", author: "/root/reviewer", recipient: "/root", content: [{ type: "input_text", text: "Reviewed auth only. TYPESAFE_API_KEY=secret-review-key\n" + "x".repeat(3000) + "\nNot reviewed: data migration." }] }),
    record({ type: "reasoning", content: [{ type: "input_text", text: "PRIVATE_REASONING" }] }),
    record({ type: "message", role: "developer", content: [{ type: "input_text", text: "HIDDEN_INSTRUCTION" }] }),
  ].join("\n"));
  await startTurn(guard);
  now = INTERVAL_MS;
  await toolEnd(guard, { transcriptPath });
  assert.equal(captured.conversation_timeline.length, 16);
  const report = captured.conversation_timeline.at(-1);
  assert.equal(report.role, "agent");
  assert.equal(report.author, "/root/reviewer");
  assert.match(report.text, /Reviewed auth only/);
  assert.match(report.text, /Not reviewed: data migration/);
  assert.match(report.text, /middle truncated/);
  assert.ok(report.text.length < 2100);
  assert.doesNotMatch(JSON.stringify(captured), /secret-review-key|PRIVATE_REASONING|HIDDEN_INSTRUCTION/);
});

test("requires a visible reflection when Jev crosses the threshold", async () => {
  let now = 0;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async () => ({ ...lowScores, focus: 0.91 }),
  });

  await startTurn(guard);
  now = INTERVAL_MS;
  const output = await toolEnd(guard);

  assert.match(output.systemMessage, /Is my \*\*focus\*\* still on the goal\?/);
  assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(output.hookSpecificOutput.additionalContext, /Before any further tool call/);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /titled exactly ‘🎯 \*\*Jev reflection\*\* — Is my \*\*focus\*\* still on the goal\?’/,
  );
  assert.match(output.hookSpecificOutput.additionalContext, /false positive/);
});

test("requires a wait-justification reflection when continued waiting needs reassessment", async () => {
  let now = 0;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async () => ({
      ...lowScores,
      pace: 0.91,
    }),
  });

  await startTurn(guard);
  now = INTERVAL_MS;
  const output = await toolEnd(guard);

  assert.match(output.systemMessage, /Is my \*\*pace\*\* appropriate for this task\?/);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /titled exactly ‘⏱️ \*\*Jev reflection\*\* — Is my \*\*pace\*\* appropriate for this task\?’/,
  );
  assert.match(output.hookSpecificOutput.additionalContext, /Do not cancel/i);
  assert.match(output.hookSpecificOutput.additionalContext, /fresh independent evidence/i);
  assert.match(output.hookSpecificOutput.additionalContext, /hard (?:gate|deadline|timeout)/i);
  assert.match(output.hookSpecificOutput.additionalContext, /remaining time and cost/i);
  assert.match(output.hookSpecificOutput.additionalContext, /ask the user/i);
  assert.match(output.hookSpecificOutput.additionalContext, /post a second user-visible commentary/i);
});

test("redacts obvious secrets before sending state to Jev", async () => {
  let now = 0;
  let capturedState;
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => {
      capturedState = state;
      return lowScores;
    },
  });

  await guard.handle({
    event: "turn_start",
    sessionId: "session",
    turnId: "turn",
    prompt: "Use TYPESAFE_API_KEY=super-secret-value",
  });
  now = INTERVAL_MS;
  await guard.handle({
    event: "tool_end",
    sessionId: "session",
    turnId: "turn",
    toolName: "Bash",
    toolInput: {
      authorization: "Bearer abc.def",
      command: "curl -H 'Authorization: Bearer abc.def'",
    },
    toolResponse: "OPENAI_API_KEY=also-secret",
  });

  await guard.turns.get("session:turn").pending;
  const serialized = JSON.stringify(capturedState);
  assert.doesNotMatch(serialized, /super-secret-value|abc\.def|also-secret/);
  assert.match(serialized, /\[redacted\]/);
});

test("redacts camelCase fields and quoted secrets in text before evaluation", async () => {
  let now = 0;
  let capturedState;
  const basicAuth = Buffer.from("fake:password").toString("base64");
  const guard = new JevGuard({
    now: () => now,
    evaluate: async (state) => { capturedState = state; return lowScores; },
  });
  await startTurn(guard, { prompt: 'password="fake multi word secret"' });
  now = INTERVAL_MS;
  await guard.handle({
    event: "tool_end", sessionId: "session", turnId: "turn", toolName: "Bash",
    toolInput: {
      apiKey: "fake-camel-key", accessToken: "fake-access-token",
      clientSecret: "fake-client-secret", "set-cookie": "fake-session-cookie",
      config: '{"api_key":"fake-json-key","password":"fake json password"}',
      command: `curl -H 'Authorization: Basic ${basicAuth}' --user 'fake-user:fake-cli-password'`,
    },
    toolResponse: `Authorization: Basic ${basicAuth}\nCookie: session=fake-cookie\nDATABASE_URL="postgres://fake-user:fake-pass@localhost/db"`,
  });
  await guard.turns.get("session:turn").pending;
  const serialized = JSON.stringify(capturedState);
  for (const secret of ["fake multi word secret", "fake-camel-key", "fake-access-token", "fake-client-secret", "fake-session-cookie", "fake-json-key", "fake json password", basicAuth, "fake-cookie", "fake-pass", "fake-cli-password"]) {
    assert.equal(serialized.includes(secret), false, `Leaked fixture: ${secret}`);
  }
});

test("keeps the TypeSafe credential out of the HTTP body and rejects redirects", async (t) => {
  const apiKey = 'fake-typesafe-key-with-"-quote';
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, ...options };
    const questions = JSON.parse(options.body).questions;
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, question.type === "noul" ? { noul: lowScores[key] ?? 0.1 } : { choice: "none" }])) }));
  });
  const scores = await evaluateWithJev({ prompt: `An unlabelled credential: ${apiKey}`, nested: { output: apiKey } }, { apiKey });
  assert.deepEqual(scores, lowScores);
  assert.equal(request.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(JSON.stringify(JSON.parse(request.body)).includes(JSON.stringify(apiKey).slice(1, -1)), false);
  assert.equal(JSON.parse(request.body).state.nested.output, "[redacted]");
  assert.equal(request.redirect, "error");
});

test("does not expose exception text in hook diagnostics", async () => {
  let now = 0;
  const guard = new JevGuard({ now: () => now, evaluate: async () => { throw new Error("TYPESAFE_API_KEY=fake-error-secret"); } });
  await startTurn(guard);
  now = INTERVAL_MS;
  const output = await toolEnd(guard);
  assert.doesNotMatch(JSON.stringify(output), /fake-error-secret/);
});

test("rejects null and out-of-range probabilities", async () => {
  for (const probability of [null, -0.1, 1.1, "0.9"]) {
    let now = 0;
    const guard = new JevGuard({ now: () => now, evaluate: async () => ({ ...lowScores, focus: probability }) });
    await startTurn(guard);
    now = INTERVAL_MS;
    const output = await toolEnd(guard);
    assert.match(output.systemMessage, /invalid response/);
    assert.doesNotMatch(output.hookSpecificOutput?.additionalContext ?? "", /Before any further tool call/);
  }
});

async function startTurn(
  guard,
  { turnId = "turn", prompt = "Make the smallest correct change and verify it." } = {},
) {
  return guard.handle({
    event: "turn_start",
    sessionId: "session",
    turnId,
    prompt,
  });
}

async function toolEnd(
  guard,
  { turnId = "turn", toolName = "Bash", transcriptPath } = {},
) {
  const event = {
    event: "tool_end",
    sessionId: "session",
    turnId,
    cwd: "/workspace",
    toolName,
    toolInput: { command: "npm test" },
    toolResponse: { exitCode: 0, output: "ok" },
    transcriptPath,
  };
  const output = await guard.handle(event);
  const pending = guard.turns.get(`session:${turnId}`).pending;
  if (pending) {
    await pending;
    return guard.handle(event);
  }
  return output;
}
