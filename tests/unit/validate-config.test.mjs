import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VALIDATOR = path.join(REPO_ROOT, ".github", "scripts", "validate-config.mjs");
const VALID_DIR = path.join(REPO_ROOT, "tests", "fixtures", "config", "valid");
const INVALID_DIR = path.join(REPO_ROOT, "tests", "fixtures", "config", "invalid");
// Filesystem/Compose-aware semantic checks (Iteration 2, spec.md User Story 5) resolve paths
// relative to process.cwd() — a fixture repo tree stands in for "the checked-out caller repo".
const SAMPLE_APP_DIR = path.join(REPO_ROOT, "tests", "fixtures", "repos", "sample-app");

function yamlToJson(filePath) {
  return execFileSync("yq", ["-o=json", "eval", ".", filePath], { encoding: "utf8" });
}

function runValidator(jsonInput) {
  return spawnSync(process.execPath, [VALIDATOR], {
    input: jsonInput,
    encoding: "utf8",
    cwd: SAMPLE_APP_DIR,
  });
}

for (const file of readdirSync(VALID_DIR)) {
  test(`valid fixture passes: ${file}`, () => {
    const json = yamlToJson(path.join(VALID_DIR, file));
    const result = runValidator(json);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  });
}

for (const file of readdirSync(INVALID_DIR)) {
  test(`invalid fixture is rejected: ${file}`, () => {
    const json = yamlToJson(path.join(INVALID_DIR, file));
    const result = runValidator(json);
    assert.notEqual(result.status, 0, `expected non-zero exit for ${file}`);
    assert.match(result.stderr, /issue\(s\)/);
  });
}

// Each of these asserts the failure message names the SPECIFIC offending value, not just that
// something failed (spec.md User Story 5 acceptance scenarios).
const EXPECTED_MESSAGE_BY_FIXTURE = {
  "missing-dockerfile.yml": /Dockerfile\.does-not-exist/,
  "missing-context.yml": /does-not-exist/,
  "missing-compose.yml": /docker-compose\.does-not-exist\.yml/,
  "service-not-in-compose.yml": /cache-that-does-not-exist/,
  "unknown-plugin.yml": /unknown plugin 'this-plugin-does-not-exist'/,
  "unknown-hook.yml": /pre_launch_party/,
  "duplicate-env-destination.yml": /duplicate destination '\.env\.app'/,
  "bad-project-name.yml": /project\.name/,
  "path-traversal.yml": /\.\.'/,
  "too-many-env-files.yml": /at most 6/,
  "bad-health-check.yml": /required/,
  "missing-migration-command.yml": /migration/,
};

for (const [file, messagePattern] of Object.entries(EXPECTED_MESSAGE_BY_FIXTURE)) {
  test(`invalid fixture names the specific problem: ${file}`, () => {
    const json = yamlToJson(path.join(INVALID_DIR, file));
    const result = runValidator(json);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, messagePattern, `stderr was:\n${result.stderr}`);
  });
}

test("rejects non-object root", () => {
  const result = runValidator("[]");
  assert.notEqual(result.status, 0);
});

test("rejects invalid JSON", () => {
  const result = runValidator("{not json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid JSON/);
});
