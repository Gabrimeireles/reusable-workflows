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

function yamlToJson(filePath) {
  return execFileSync("yq", ["-o=json", "eval", ".", filePath], { encoding: "utf8" });
}

function runValidator(jsonInput) {
  return spawnSync(process.execPath, [VALIDATOR], { input: jsonInput, encoding: "utf8" });
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

test("rejects non-object root", () => {
  const result = runValidator("[]");
  assert.notEqual(result.status, 0);
});

test("rejects invalid JSON", () => {
  const result = runValidator("{not json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid JSON/);
});
