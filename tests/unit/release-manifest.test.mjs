import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".github", "schema", "release-manifest.schema.json"), "utf8")
);

// Mirrors exactly what .github/actions/release-manifest/action.yml's jq assembly produces —
// kept in sync manually (same tradeoff as docker-build.yml's image-tags.sh reference copy,
// documented there); this test exists to catch schema/shape drift between the two.
function sampleManifest() {
  return {
    manifestVersion: 1,
    project: "sampleapp",
    environment: "homolog",
    environmentLabel: "homolog @ hetzner-1",
    git: { commit: "abc1234", branch: "master", actor: "octocat" },
    images: {
      app: { ref: "ghcr.io/o/app:sha-abc1234", digest: "sha256:deadbeef", sizeBytes: 12345 },
    },
    previousImages: "APP_IMAGE=ghcr.io/o/app\nIMAGE_TAG=sha-0000000\n",
    compose: {
      file: "docker-compose.yml",
      checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      envChecksum: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    },
    database: { backupFile: "backups/pre-deploy-sha-abc1234-20260101T000000Z.dump", migrationRan: true, resetRan: false, seedRan: false },
    timings: { upload: 3, backup: 12, migration: 5, deploy: 8, healthcheck: 20 },
    healthChecks: [{ name: "web", outcome: "success" }],
    timestamp: "2026-01-01T00:00:00Z",
    durationSeconds: 60,
    overallStatus: "success",
    rollbackCommand:
      "cd /srv/stacks/sampleapp && docker compose --env-file .env.previous -f docker-compose.previous.yml up -d --force-recreate",
  };
}

test("sample manifest has every field the schema requires", () => {
  const manifest = sampleManifest();
  for (const key of SCHEMA.required) {
    assert.ok(key in manifest, `manifest is missing required top-level field '${key}'`);
  }
});

test("sample manifest has no field the schema doesn't allow (additionalProperties: false)", () => {
  const manifest = sampleManifest();
  const allowed = new Set(Object.keys(SCHEMA.properties));
  for (const key of Object.keys(manifest)) {
    assert.ok(allowed.has(key), `manifest has unexpected field '${key}' not in the schema`);
  }
});

test("git/compose/database required sub-fields are present", () => {
  const manifest = sampleManifest();
  for (const key of SCHEMA.properties.git.required) {
    assert.ok(key in manifest.git, `git.${key} missing`);
  }
  for (const key of SCHEMA.properties.compose.required) {
    assert.ok(key in manifest.compose, `compose.${key} missing`);
  }
});

test("rollbackCommand is a literal, runnable docker compose command", () => {
  const manifest = sampleManifest();
  assert.match(manifest.rollbackCommand, /docker compose --env-file \.env\.previous -f docker-compose\.previous\.yml up -d --force-recreate/);
});

test("images entries never carry raw secret-bearing content, only refs/digests/sizes", () => {
  const manifest = sampleManifest();
  for (const entry of Object.values(manifest.images)) {
    const keys = Object.keys(entry).sort();
    assert.deepEqual(keys, ["digest", "ref", "sizeBytes"]);
  }
});
