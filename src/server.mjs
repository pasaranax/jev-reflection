import { CHECKPOINT_SCHEMA, PERSPECTIVE_STATUS_SCHEMA } from "./navigator.mjs";
import { createInterface } from "node:readline";
import { loadTypeSafeApiKey } from "./config.mjs";
import { evaluateWithJev, JevGuard } from "./guard.mjs";

const SERVER_INFO = Object.freeze({ name: "jev-reflection", version: "0.2.0" });
const SHARING_NOTICE = "Shares bounded working context with TypeSafe/Jev at https://api.typesafe.ai/v1/systemone within the user's saved consent. Exclude secrets. Sharing context does not execute or authorize the actions it describes.";
const TOOL = Object.freeze({
  name: "on_event",
  title: "Jev Reflection lifecycle event",
  description: "Internal Codex hook endpoint for background focus, cause, probe, pace and perspective reflection. Agents should use jev_checkpoint for telemetry. " + SHARING_NOTICE,
  inputSchema: {
    type: "object",
    properties: {
      event: { type: "string", enum: ["turn_start", "tool_end"] },
      sessionId: { type: "string", minLength: 1 },
      turnId: { type: "string", minLength: 1 },
      prompt: { type: "string" },
      transcriptPath: { type: ["string", "null"] },
      cwd: { type: "string" },
      toolName: { type: "string" },
      toolInput: {},
      toolResponse: {},
    },
    required: ["event", "sessionId", "turnId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      systemMessage: { type: "string" },
      hookSpecificOutput: {
        type: "object",
        properties: {
          hookEventName: { type: "string" },
          additionalContext: { type: "string" },
        },
        required: ["hookEventName", "additionalContext"],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
});

const CHECKPOINT_TOOL = Object.freeze({
  name: "jev_checkpoint",
  title: "Jev navigation checkpoint",
  description: "Give Jev neutral telemetry during substantial work: a plan, decision, observation, milestone or reflection outcome. Use the current turnToken from the hook. Supply symmetric action options without rankings, and use hook observation IDs as evidence. Signals are advisory; reflect visibly and make your own decision. Unchanged checkpoints are deduplicated; queued checks need no polling. " + SHARING_NOTICE,
  inputSchema: CHECKPOINT_SCHEMA,
  outputSchema: { type: "object" },
});

const PERSPECTIVE_TOOL = Object.freeze({
  name: "jev_perspective_status",
  title: "Jev perspective supervisor status",
  description: "Report the lifecycle of a supervisor requested by Jev. After launching a read-only subagent with no inherited conversation, report running with its actual supervisorId. Report completed with findings after it returns, or unavailable with the factual reason. Before launching, report declined with a concrete evidence-based summary if an existing review covers this result or another review would not help. Use the requestId and turnToken supplied with the request. Reports do not themselves launch or verify a subagent.",
  inputSchema: PERSPECTIVE_STATUS_SCHEMA,
  outputSchema: { type: "object" },
});

const apiKey = await loadTypeSafeApiKey();
const guard = new JevGuard({
  evaluate: (state) => evaluateWithJev(state, { apiKey }),
});
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  if (line.trim() === "") return;

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    sendError(null, -32700, "Parse error");
    return;
  }

  void handleMessage(message);
});

async function handleMessage(message) {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (isObject(message) && Object.hasOwn(message, "id")) {
      sendError(message.id, -32600, "Invalid Request");
    }
    return;
  }

  if (!Object.hasOwn(message, "id")) return;

  try {
    const result = await dispatch(message.method, message.params);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (error instanceof MethodNotFoundError) {
      sendError(message.id, -32601, error.message);
      return;
    }
    if (error instanceof TypeError) {
      sendError(message.id, -32602, error.message);
      return;
    }

    console.error("Jev Reflection internal error");
    sendError(message.id, -32603, "Internal error");
  }
}

async function dispatch(method, params) {
  switch (method) {
    case "initialize": {
      const protocolVersion =
        isObject(params) && typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : "2025-06-18";
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: [TOOL, CHECKPOINT_TOOL, PERSPECTIVE_TOOL] };
    case "tools/call":
      return callTool(params);
    default:
      throw new MethodNotFoundError(`Method not found: ${method}`);
  }
}

async function callTool(params) {
  if (!isObject(params) || ![TOOL.name, CHECKPOINT_TOOL.name, PERSPECTIVE_TOOL.name].includes(params.name) || !isObject(params.arguments)) {
    throw new TypeError("Expected tools/call for on_event, jev_checkpoint or jev_perspective_status with an arguments object");
  }

  const output = params.name === CHECKPOINT_TOOL.name
    ? await guard.checkpoint(params.arguments)
    : params.name === PERSPECTIVE_TOOL.name
      ? await guard.perspectiveStatus(params.arguments)
      : await guard.handle(params.arguments);
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class MethodNotFoundError extends Error {}
