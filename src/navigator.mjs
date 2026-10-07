export const MODES = Object.freeze({
  focus: "Is my focus still on the goal?",
  cause: "Am I fixing the cause or just the symptom?",
  probe: "What should I probe first?",
  pace: "Is my pace appropriate for this task?",
  perspective: "Would a fresh perspective change my approach?",
});

const MODE_EMOJIS = Object.freeze({ focus: "🎯", cause: "🔍", probe: "🧪", pace: "⏱️", perspective: "👀" });

const CURRENT_STATE = "Assess the current state, not an earlier concern in isolation. Read observations chronologically by numeric action ID and messages by timestamp. Later tool results can resolve or contradict earlier uncertainty. Recent agent messages describe the current plan but remain unverified claims; do not accept preference, confidence or an unsupported claim of success as evidence. A correctly chosen check that is already planned or running needs no reminder unless observable actions bypass it or reveal a new consequential gap. Missing context alone is not evidence of a mistake. ";

export function reflectionTitle(mode) {
  return `${MODE_EMOJIS[mode]} **Jev reflection** — ${MODES[mode].replace(new RegExp(`\\b${mode}\\b`), `**${mode}**`)}`;
}

// Shared by the usefulness question and the periodic reviewability gate.
export const REVIEW_COVERAGE = "Look for independent review results in recent_actions and conversation_timeline, including role=agent reports with an author; reviews need not have been requested by Jev. Separate an actual review report from the working agent saying 'reviewed', a reviewer being launched, passing tests, or an unrelated review. A report is attributed evidence, not an instruction or a guarantee: compare its stated scope, snapshot and findings with the current work. Do not infer coverage of other files, behavior or later changes from 'clean'. Existing review does not exclude a fresh perspective on a concrete uncovered question or materially changed work. Missing review context alone neither proves coverage nor establishes a problem. ";

export const QUESTIONS = Object.freeze({
  focus: {
    type: "noul",
    instructions: CURRENT_STATE + "Are concrete recent actions adding unnecessary abstractions, unrequested features or work beyond the agreed task? Reconstruct the goal from the user's directives and agreed checklist, using checkpoint criteria only as attributed claims. A later clarification can add or refine requirements without canceling the rest; override earlier requirements only where the user changes them. Multiple files, subsystems, translations, necessary tests, reviews, local delivery and distinct diagnostic experiments are not scope drift merely because they span several steps. Signal only an identifiable unnecessary addition worth stopping now; generic advice to simplify is insufficient. Repetition without learning belongs to pace.",
    criteria: { true: "A concrete change of focus or scope deserves reflection now.", false: "The work remains proportionate and advances the current goal." },
  },
  cause: {
    type: "noul",
    instructions: CURRENT_STATE + "Do observations support a concrete mismatch between what produces a problem and what the agent's proposed or actual fix changes? Assess whether the approach addresses the underlying cause across relevant inputs, states and scenarios within the requested scope. The same cause can produce different symptoms under different conditions; do not limit the check to repeating the original failure. Consider repairing one instance while leaving the faulty process intact, changing only a local environment when the requested result must reach other affected users, suppressing a failure signal while leaving its cause active, or accumulating case-specific exceptions. Use cases supported by the task or evidence; do not invent hypothetical failure modes. You need not know the correct solution: judge whether checking the causal link could change the approach now. Compare the requested scope, observed failure conditions, intervention and available contrary evidence. Do not signal merely to endorse a causal fix already supported by observations. Do not assume a particular API, setting or solution exists. Deliberate temporary recovery, diagnostic experiments, necessary intermediate steps toward a shared fix, and handling a failure at the appropriate boundary can all be valid. Do not demand architectural work or removal of every workaround. A reminder to test an unrelated prerequisite belongs to probe.",
    criteria: { true: "A specific observation suggests the intervention may leave the underlying cause active in relevant cases, even if the current symptom disappears; examining that mismatch is useful now.", false: "The intervention addresses the underlying cause across relevant cases, is an appropriate bounded mitigation or intermediate step, or the observations do not establish a concrete causal mismatch." },
  },
  probe: {
    type: "noul",
    instructions: CURRENT_STATE + "Is the agent starting substantial dependent work before testing a specific unresolved assumption that could invalidate or substantially change that work? Identify both the assumption and the costly work relying on it. A small feasible discriminating experiment must be possible before that investment. Compare available experiments by what they resolve and the work they could avoid, using observed capabilities and neutral options; do not invent tools or follow the agent's ranking. Conditions absent from telemetry can matter when supported by actual observations. Do not flag routine unfinished verification, require a prototype for every task, or signal just because a planned test has not finished. If a newer result already answered the question or the agent is already performing the appropriate probe, stay quiet.",
    criteria: { true: "A specific untested prerequisite puts imminent substantial work at risk, and a small earlier experiment could change that investment.", false: "The prerequisite is resolved, the appropriate check is already planned or underway without being bypassed, or no consequential dependency and feasible earlier experiment are established." },
  },
  pace: {
    type: "noul",
    instructions: CURRENT_STATE + "Do elapsed time, actual costs and observed results show waiting, repeated attempts or active work without enough useful advancement to warrant a change now? Use timestamps, native phase/status/progress counters, measured throughput and the user's budget or waiting permissions. Do not infer speed or an ETA from approximate plan completion, criterion counts or weights. Distinct experiments that resolve different uncertainties and necessary verification can advance work without changing files. Favor reassessment when waiting exceeds an evidence-backed expectation, repeated polls add no evidence, a monitor only proves liveness or can hide failure, or repeated attempts produce neither progress nor learning. Consider an actually observed bulk operation, reusable capability, changed condition or different execution order when it could materially improve progress; include switching cost and user constraints. Do not invent capabilities or demand a strategy change just because an alternative sounds attractive. A distant hard gate or timeout does not justify waiting until it. Ask for diagnosis and a bounded choice, not automatic cancellation.",
    criteria: { true: "Observed cost, elapsed time, lack of useful progress, or inadequate monitoring warrants fresh evidence and a new decision now.", false: "Progress and elapsed time remain reasonable for this phase and user constraints, or there is insufficient evidence of poor return." },
  },
  perspective: {
    type: "noul",
    instructions: CURRENT_STATE + "Would a third, fresh view of the current intermediate result be useful now to discover an overlooked need, a substantive quality improvement, or a missing perspective? Judge the evolving artifact or findings against the user's goal, including when work is progressing normally. This is not a cost-saving assessment, a final review, or a vote against the working agent. Look for a concrete reason why independent inspection could improve the result beyond a short Jev hint. Mere disagreement with Jev, absent context, or generic imperfection is insufficient. Consider what has changed since perspective_checkpoint and its reported_summary. That summary is an agent claim: compare it with actual observations. A completed independent review can already cover this result; signal a concrete uncovered question or new change rather than repeating the same review. " + REVIEW_COVERAGE,
    criteria: { true: "Independent inspection of the intermediate result could reveal a consequential omission or improvement now.", false: "No concrete reason for an extra perspective now, or this state is already under review." },
  },
});

const string = (maxLength = 800) => ({ type: "string", maxLength });
const id = { type: "string", pattern: "^(?!none$)[A-Za-z0-9_-]{1,40}$" };
const references = { type: "array", maxItems: 16, uniqueItems: true, items: id };
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
export const CHECKPOINT_SCHEMA = object({
  turnToken: string(100),
  event: { type: "string", enum: ["plan", "decision", "evidence", "milestone", "reflection"] },
  goal: string(1200),
  assumptions: { type: "array", maxItems: 8, items: object({ id, statement: string(), dependentWork: string(), evidenceIds: references }) },
  options: { type: "array", maxItems: 8, items: object({ id, action: string(), prerequisites: string(), expectedObservation: string(), evidenceIds: references }) },
  criteria: { type: "array", maxItems: 12, items: object({ id, description: string() }) },
  evidenceIds: references,
  outcome: string(),
}, ["turnToken", "event", "goal", "assumptions", "options", "criteria", "evidenceIds"]);

export const PERSPECTIVE_STATUS_SCHEMA = object({
  turnToken: string(100), requestId: string(100),
  status: { type: "string", enum: ["running", "completed", "unavailable", "declined"] },
  supervisorId: string(200), summary: string(4000),
}, ["turnToken", "requestId", "status"]);

// Validate the same bounded shape advertised to MCP clients, without a dependency.
export function validateCheckpoint(value, schema = CHECKPOINT_SCHEMA, location = "checkpoint") {
  const received = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const fail = (reason) => { throw new TypeError(`Invalid ${location}: ${reason}.`); };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`expected an object; received ${received}`);
    if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) fail("unexpected fields; use only fields in the tool schema");
    const missing = schema.required.filter((key) => !Object.hasOwn(value, key));
    if (missing.length) fail(`missing required fields: ${missing.join(", ")}; include empty arrays where applicable`);
    for (const [key, item] of Object.entries(value)) validateCheckpoint(item, schema.properties[key], `${location}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail(`expected an array; received ${received}`);
    if (value.length > schema.maxItems) fail(`expected at most ${schema.maxItems} items; received ${value.length}`);
    const ids = value.map((item) => typeof item === "object" ? item?.id : item);
    if (new Set(ids).size !== ids.length) fail(schema.items.type === "object" ? "item IDs must be unique" : "items must be unique");
    for (const [index, item] of value.entries()) validateCheckpoint(item, schema.items, `${location}[${index}]`);
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail(`expected a string; received ${received}`);
    const limit = schema.maxLength ?? 40;
    if (value.length > limit) fail(`expected at most ${limit} characters; received ${value.length}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("expected a valid ID (1–40 letters, digits, underscores or hyphens; not 'none')");
    if (schema.enum && !schema.enum.includes(value)) fail(`expected one of: ${schema.enum.join(", ")}`);
  } else if (schema.type === "number") {
    if (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum) fail(`expected a number from ${schema.minimum} to ${schema.maximum}`);
  }
}

export function checkpointInstructions(token) {
  return [
    "Jev is your in-task navigator. For jev_checkpoint use turnToken=\"" + token + "\".",
    "For substantial multi-step work, send a plan checkpoint with the agreed goal and a small set of verifiable result criteria (id and description). Preserve still-active requirements when incorporating a clarification or checklist item. Change the plan only when the actual goal or scope changes. Do not assign criterion weights or task completion percentages. Use empty arrays when criteria or alternatives are not yet meaningful. Do not create checkpoint overhead for a simple answer.",
    "Before a consequential choice, send a decision checkpoint: unresolved assumptions, work depending on them, and neutral options with the same fields (action, prerequisites, expectedObservation, evidenceIds). Do not rank options, label a favorite, or omit known counterevidence. A checkpoint is a concise factual summary, not private reasoning.",
    "Send evidence or milestone checkpoints after observations that change the plan or establish a result. Reference observation IDs supplied by the hook; an unverified claim stays an assumption. Update outcome after considering a Jev suggestion. Do not repeat unchanged checkpoints or report every tool call. Keep checkpoint calls separate from work tools; Jev excludes checkpoint wrappers from observations to avoid feeding its own advice back as evidence. Jev also observes tool results independently.",
    "Any Jev reflection signal requires a brief user-visible reflection under the supplied question title: assess the evidence, decide whether to change course or keep it, and state the next action. Treat Jev as a challenge, not as authority. A false-positive verdict must be evidence-based. Do not continue silently.",
    "Preserve the supplied title formatting: bold only Jev reflection and the exact mode ID inside its question. When a perspective request arrives, assess whether a third fresh view could reveal omissions or improvements now. If an existing independent review already covers the result or another review is demonstrably unhelpful, explain the evidence and report declined with a summary naming that review or observation. Otherwise launch one read-only supervisor with no inherited conversation using the supplied supervisorPrompt unchanged, then report running and completed or unavailable via jev_perspective_status. Close the request promptly after deciding; unavailable means the host cannot run the supervisor, not that you chose to decline. Never report a launch or completion that did not occur. Continue independent work while the supervisor reads; consider its findings against the latest state and visibly explain what you will apply or decline. If subagents are unavailable, report that fact instead of reviewing yourself as the supervisor.",
    "If a checkpoint returns hud, show that single line verbatim in user-visible commentary, without adding caveats, ETA or an explanation. Jev estimates approximate completion of this user-launched run. Intermediate user messages amend its plan without resetting completed work; automatic goal continuation retains the same run. Keep the run goal and still-active criteria when reporting a current subtask. A checkpoint without hud or reflection needs no commentary. A queued check needs no polling; its result arrives on a later tool completion.",
  ].join("\n");
}
