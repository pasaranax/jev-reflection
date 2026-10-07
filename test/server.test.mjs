import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("MCP client discovers checkpoint telemetry, receives a token, and receives a compact model-estimated progress bar", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-server-"));
  const clock = path.join(directory, "clock");
  await writeFile(clock, "0");
  const preload = path.join(directory, "fake-api.mjs");
  await writeFile(preload, `
    import { readFileSync } from 'node:fs';
    Date.now = () => Number(readFileSync(${JSON.stringify(clock)}, 'utf8'));
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const perspective = body.state.current_user_directive?.includes('fresh perspective');
      const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key,
        q.type === 'noul' ? { noul: perspective && ['perspective', 'reviewable_work'].includes(key) ? 0.95 : 0.1 }
          : { choice: key === 'plan_progress' ? 'p40' : 'none', confidence: 0.99 }
      ]));
      return new Response(JSON.stringify({ answers }));
    };
  `);
  const child = spawn(process.execPath, ["--import", preload, "src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, CODEX_HOME: directory, TYPESAFE_API_KEY: "fake-offline-key" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = createInterface({ input: child.stdout });
  let sequence = 0;
  const pending = new Map();
  reader.on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => reject(new Error("MCP response timed out")), 3000);
    pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  t.after(async () => { child.kill(); reader.close(); await rm(directory, { recursive: true, force: true }); });
  const listed = await call("tools/list");
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["on_event", "jev_checkpoint", "jev_perspective_status"]);
  const start = await call("tools/call", { name: "on_event", arguments: { event: "turn_start", sessionId: "s", turnId: "t", prompt: "Read the source data." } });
  const token = start.result.structuredContent.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)[1];
  const observation = await call("tools/call", { name: "on_event", arguments: { event: "tool_end", sessionId: "s", turnId: "t", toolName: "read", toolInput: "source.csv", toolResponse: "Read all 12 rows" } });
  assert.match(observation.result.structuredContent.hookSpecificOutput.additionalContext, /a1/);
  const checkpoint = { turnToken: token, event: "milestone", goal: "Read the source data.", assumptions: [], options: [], criteria: [{ id: "read", description: "Read all source rows" }], evidenceIds: ["a1"] };
  const initial = await call("tools/call", { name: "jev_checkpoint", arguments: checkpoint });
  assert.equal(initial.result.structuredContent.hud, undefined);
  assert.equal(initial.result.structuredContent.progressPercent, undefined);
  await writeFile(clock, String(15 * 60_000));
  const assessed = await call("tools/call", { name: "jev_checkpoint", arguments: { ...checkpoint, outcome: "Source rows checked against the plan." } });
  assert.equal(assessed.result.structuredContent.progress, undefined);
  assert.equal(assessed.result.structuredContent.signals.route, undefined);
  assert.equal(assessed.result.structuredContent.hud, "●●●●○○○○○○ — ~40% of the plan completed.");
  assert.equal(assessed.result.structuredContent.progressPercent, 40);
  assert.doesNotMatch(assessed.result.content[0].text, /coveragePercent|percentagePointsPerMinute/);
  const bad = await call("tools/call", { name: "jev_checkpoint", arguments: { ...checkpoint, preferred: "A" } });
  assert.equal(bad.error.code, -32602);

  const next = await call("tools/call", { name: "on_event", arguments: { event: "turn_start", sessionId: "s", turnId: "next", prompt: "Build search with a fresh perspective on the result." } });
  const nextToken = next.result.structuredContent.hookSpecificOutput.additionalContext.match(/turnToken="([^"]+)"/)[1];
  await call("tools/call", { name: "on_event", arguments: { event: "tool_end", sessionId: "s", turnId: "next", toolName: "read", toolResponse: "Search interface rendered" } });
  const review = await call("tools/call", { name: "jev_checkpoint", arguments: { ...checkpoint, turnToken: nextToken, criteria: [], evidenceIds: [] } });
  const request = review.result.structuredContent.perspective;
  assert.ok(request.requestId);
  assert.equal(request.forkTurns, "none");
  const status = (fields) => call("tools/call", { name: "jev_perspective_status", arguments: { turnToken: nextToken, requestId: request.requestId, ...fields } });
  assert.equal((await status({ status: "completed", summary: "Not actually launched" })).error.code, -32602);
  assert.equal((await status({ status: "running", supervisorId: "actual-host-agent-id" })).result.structuredContent.status, "recorded");
  assert.equal((await status({ status: "completed", summary: "Add a useful empty state." })).result.structuredContent.status, "recorded");
  assert.equal((await status({ status: "running", supervisorId: "duplicate" })).error.code, -32602);
});
