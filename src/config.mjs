import { readFile as readTextFile } from "node:fs/promises";
import path from "node:path";

const TARGET_SECTION = "shell_environment_policy.set";
const TARGET_KEY = "TYPESAFE_API_KEY";

export async function loadTypeSafeApiKey({ env = process.env, readFile = readTextFile } = {}) {
  const inherited = nonEmptyString(env[TARGET_KEY]);
  if (inherited) return inherited;

  const codexHome = nonEmptyString(env.CODEX_HOME)
    ?? (nonEmptyString(env.HOME) ? path.join(env.HOME, ".codex") : undefined);
  if (!codexHome) return undefined;

  let source;
  try {
    source = await readFile(path.join(codexHome, "config.toml"), "utf8");
  } catch {
    return undefined;
  }

  return readStringValueFromSection(source, TARGET_SECTION, TARGET_KEY);
}

function readStringValueFromSection(source, sectionName, keyName) {
  let inTargetSection = false;

  for (const rawLine of String(source).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const section = rawLine.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);
    if (section) {
      inTargetSection = section[1] === sectionName;
      continue;
    }
    if (!inTargetSection) continue;

    const assignment = rawLine.match(
      new RegExp(`^\\s*${escapeRegExp(keyName)}\\s*=\\s*(.*)$`),
    );
    if (!assignment) continue;

    return parseSingleLineTomlString(assignment[1]);
  }

  return undefined;
}

function parseSingleLineTomlString(value) {
  const input = value.trimStart();
  const quote = input[0];
  if (quote !== '"' && quote !== "'") return undefined;

  let escaped = false;
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === quote && !escaped) {
      const trailing = input.slice(index + 1).trim();
      if (trailing !== "" && !trailing.startsWith("#")) return undefined;

      const quoted = input.slice(0, index + 1);
      const parsed = quote === '"' ? parseBasicString(quoted) : quoted.slice(1, -1);
      return nonEmptyString(parsed);
    }
    escaped = false;
  }

  return undefined;
}

function parseBasicString(quoted) {
  try {
    return JSON.parse(quoted);
  } catch {
    return undefined;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
