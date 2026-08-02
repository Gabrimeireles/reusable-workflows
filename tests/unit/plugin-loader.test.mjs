import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlugins, PluginError } from "../../.github/scripts/lib/plugin-loader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_PLUGINS_DIR = path.join(REPO_ROOT, ".github", "plugins");
const FIXTURE_PLUGINS_DIR = path.join(REPO_ROOT, "tests", "fixtures", "plugins");

test("plugin default fills a field the caller left unset", async () => {
  const { config, issues } = await resolvePlugins(
    { plugins: ["fixture-plugin"], database: { enabled: true, containerDatabase: "x" } },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(issues.length, 0);
  assert.equal(config.database.containerUser, "fixture-default-user");
});

test("caller's own value always wins over a plugin default", async () => {
  const { config, issues } = await resolvePlugins(
    {
      plugins: ["fixture-plugin"],
      database: { enabled: true, containerDatabase: "x", containerUser: "caller-chosen" },
    },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(issues.length, 0);
  assert.equal(config.database.containerUser, "caller-chosen");
});

test("later-declared plugin wins among plugins for the same unset field", async () => {
  const { config, issues } = await resolvePlugins(
    { plugins: ["fixture-plugin", "fixture-plugin-2"], database: { enabled: false } },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(issues.length, 0);
  assert.equal(config.database.containerUser, "fixture-2-default-user");
});

test("reversing declaration order reverses which plugin wins", async () => {
  const { config } = await resolvePlugins(
    { plugins: ["fixture-plugin-2", "fixture-plugin"], database: { enabled: false } },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(config.database.containerUser, "fixture-default-user");
});

test("unknown plugin name produces a specific, non-throwing issue", async () => {
  const { issues } = await resolvePlugins({ plugins: ["does-not-exist"] }, FIXTURE_PLUGINS_DIR);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /unknown plugin 'does-not-exist'/);
});

test("plugin validate() rule fires against the merged config", async () => {
  const { issues } = await resolvePlugins(
    { plugins: ["fixture-plugin"], database: { enabled: true } },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /requires database.containerDatabase/);
});

test("plugin-provided hook is folded in when the caller declares none", async () => {
  const { config } = await resolvePlugins({ plugins: ["fixture-plugin"] }, FIXTURE_PLUGINS_DIR);
  assert.equal(config.hooks.pre_migration, "echo fixture-plugin pre_migration");
});

test("caller's own hook for the same name wins over the plugin's", async () => {
  const { config } = await resolvePlugins(
    { plugins: ["fixture-plugin"], hooks: { pre_migration: "echo caller" } },
    FIXTURE_PLUGINS_DIR
  );
  assert.equal(config.hooks.pre_migration, "echo caller");
});

test("no declared plugins leaves the config untouched", async () => {
  const input = { project: { name: "x" } };
  const { config, issues } = await resolvePlugins(input, FIXTURE_PLUGINS_DIR);
  assert.equal(issues.length, 0);
  assert.deepEqual(config, input);
});

for (const name of ["postgres", "redis", "prisma", "nestjs", "nextjs", "vite"]) {
  test(`shipped plugin '${name}' loads and exports the expected shape`, async () => {
    const { issues } = await resolvePlugins({ plugins: [name] }, REAL_PLUGINS_DIR);
    assert.equal(issues.length, 0, `unexpected issues loading '${name}': ${issues.join(", ")}`);
  });
}

test("PluginError is exported for callers that want to distinguish plugin failures", () => {
  assert.equal(typeof PluginError, "function");
});
