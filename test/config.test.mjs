import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadTypeSafeApiKey } from "../src/config.mjs";

test("prefers the process environment without reading Codex config", async () => {
  let reads = 0;
  const key = await loadTypeSafeApiKey({
    env: { TYPESAFE_API_KEY: "from-environment" },
    readFile: async () => {
      reads += 1;
      return "";
    },
  });

  assert.equal(key, "from-environment");
  assert.equal(reads, 0);
});

test("loads the key from shell_environment_policy.set", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "jev-reflection-"));
  await writeFile(
    path.join(codexHome, "config.toml"),
    [
      "model = 'example'",
      "",
      "[shell_environment_policy.set]",
      "TYPESAFE_API_KEY = 'from-codex-config'",
      "ANOTHER_VALUE = 'ignored'",
      "",
      "[features]",
      "example = true",
    ].join("\n"),
  );

  const key = await loadTypeSafeApiKey({ env: { CODEX_HOME: codexHome } });

  assert.equal(key, "from-codex-config");
});

test("does not accept the same key from another TOML section", async () => {
  const key = await loadTypeSafeApiKey({
    env: { HOME: "/unused" },
    readFile: async () =>
      [
        "[unrelated]",
        "TYPESAFE_API_KEY = 'wrong'",
        "",
        "[shell_environment_policy.set]",
        "OTHER = 'value'",
      ].join("\n"),
  });

  assert.equal(key, undefined);
});

test("supports quoted values followed by TOML comments", async () => {
  const key = await loadTypeSafeApiKey({
    env: { HOME: "/unused" },
    readFile: async () =>
      '[shell_environment_policy.set]\nTYPESAFE_API_KEY = "key-with-#-inside" # comment\n',
  });

  assert.equal(key, "key-with-#-inside");
});
