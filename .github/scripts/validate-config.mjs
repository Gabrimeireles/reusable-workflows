#!/usr/bin/env node
// Hand-written structural validator for the declarative deploy config
// (.github/schema/deploy-config.schema.json is the documented source of truth this
// mirrors). Deliberately dependency-free (no ajv/jsonschema) — see
// docs/adr/0003-config-model.md and specs/001-reusable-ci-platform/research.md R5.
//
// Usage: node validate-config.mjs < config.json
// Reads JSON on stdin (the caller is expected to convert YAML -> JSON with `yq` first).
// On success: prints the (defaults-applied) config as compact JSON on stdout, exits 0.
// On failure: prints every error found, one per line, to stderr, exits 1.

const NAME_RE = /^[a-z][a-z0-9-]{1,48}$/;
const SHORT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const IMAGE_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SECRET_LABEL_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_FILENAME_RE = /^\.[a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
const COMPOSE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
const SECRET_LOOKING_KEY_RE = /(SECRET|TOKEN|PASSWORD|KEY)/i;
const MAX_ENV_FILES = 6;

const errors = [];
function fail(path, message) {
  errors.push(`${path}: ${message}`);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function noTraversal(path, value) {
  if (typeof value !== "string") return;
  if (value === "" || /(^|\/)\.\.(\/|$)/.test(value)) {
    fail(path, `must not contain '..' path traversal (got '${value}')`);
  }
}

function validate(config) {
  if (!isPlainObject(config)) {
    fail("$", "root must be an object");
    return;
  }

  const allowedTop = new Set([
    "version",
    "project",
    "images",
    "compose",
    "environmentFiles",
    "database",
    "healthChecks",
  ]);
  for (const key of Object.keys(config)) {
    if (!allowedTop.has(key)) fail("$", `unexpected top-level key '${key}'`);
  }

  if (config.version !== 1) fail("$.version", "must be exactly 1");

  // project
  const project = config.project;
  if (!isPlainObject(project)) {
    fail("$.project", "is required and must be an object");
  } else {
    if (typeof project.name !== "string" || !NAME_RE.test(project.name)) {
      fail("$.project.name", `must match ${NAME_RE}`);
    }
    if (project.deployPath !== undefined) {
      if (typeof project.deployPath !== "string" || !project.deployPath.startsWith("/srv/stacks/")) {
        fail("$.project.deployPath", "must be an absolute path under /srv/stacks/");
      }
      noTraversal("$.project.deployPath", project.deployPath);
    }
  }

  // images
  const images = config.images;
  if (!Array.isArray(images) || images.length < 1) {
    fail("$.images", "is required and must be a non-empty array");
  } else {
    const seenIds = new Set();
    images.forEach((img, i) => {
      const p = `$.images[${i}]`;
      if (!isPlainObject(img)) { fail(p, "must be an object"); return; }
      if (typeof img.id !== "string" || !SHORT_NAME_RE.test(img.id)) fail(`${p}.id`, `must match ${SHORT_NAME_RE}`);
      else if (seenIds.has(img.id)) fail(`${p}.id`, `duplicate image id '${img.id}'`);
      else seenIds.add(img.id);
      if (typeof img.name !== "string" || !IMAGE_NAME_RE.test(img.name)) fail(`${p}.name`, `must match ${IMAGE_NAME_RE}`);
      if (typeof img.context !== "string" || img.context.length === 0) fail(`${p}.context`, "is required");
      else noTraversal(`${p}.context`, img.context);
      if (typeof img.dockerfile !== "string" || img.dockerfile.length === 0) fail(`${p}.dockerfile`, "is required");
      else noTraversal(`${p}.dockerfile`, img.dockerfile);
      if (img.buildArgs !== undefined) {
        if (!isPlainObject(img.buildArgs)) fail(`${p}.buildArgs`, "must be an object of string values");
        else for (const [k, v] of Object.entries(img.buildArgs)) {
          if (SECRET_LOOKING_KEY_RE.test(k)) fail(`${p}.buildArgs.${k}`, "build arg keys must not look like a secret (SECRET/TOKEN/PASSWORD/KEY)");
          if (typeof v !== "string") fail(`${p}.buildArgs.${k}`, "value must be a string");
        }
      }
    });
  }

  // compose
  const compose = config.compose;
  if (!isPlainObject(compose)) {
    fail("$.compose", "is required and must be an object");
  } else {
    if (typeof compose.source !== "string" || compose.source.length === 0) fail("$.compose.source", "is required");
    else noTraversal("$.compose.source", compose.source);
    if (compose.destination !== undefined && !COMPOSE_FILENAME_RE.test(compose.destination)) {
      fail("$.compose.destination", `must match ${COMPOSE_FILENAME_RE}`);
    }
    for (const field of ["dependencyServices", "applicationServices"]) {
      if (compose[field] !== undefined) {
        if (!Array.isArray(compose[field])) fail(`$.compose.${field}`, "must be an array of service names");
        else compose[field].forEach((s, i) => {
          if (typeof s !== "string" || !SHORT_NAME_RE.test(s)) fail(`$.compose.${field}[${i}]`, `must match ${SHORT_NAME_RE}`);
        });
      }
    }
  }

  // environmentFiles
  if (config.environmentFiles !== undefined) {
    if (!Array.isArray(config.environmentFiles)) {
      fail("$.environmentFiles", "must be an array");
    } else if (config.environmentFiles.length > MAX_ENV_FILES) {
      fail("$.environmentFiles", `supports at most ${MAX_ENV_FILES} entries (positional ENV_FILE_1..ENV_FILE_${MAX_ENV_FILES})`);
    } else {
      config.environmentFiles.forEach((ef, i) => {
        const p = `$.environmentFiles[${i}]`;
        if (!isPlainObject(ef)) { fail(p, "must be an object"); return; }
        if (typeof ef.secret !== "string" || !SECRET_LABEL_RE.test(ef.secret)) fail(`${p}.secret`, `must match ${SECRET_LABEL_RE} (documentation label only)`);
        if (typeof ef.destination !== "string" || !ENV_FILENAME_RE.test(ef.destination)) fail(`${p}.destination`, `must match ${ENV_FILENAME_RE}`);
        if (ef.required !== undefined && typeof ef.required !== "boolean") fail(`${p}.required`, "must be a boolean");
      });
    }
  }

  // database
  const db = config.database;
  if (db !== undefined) {
    if (!isPlainObject(db)) {
      fail("$.database", "must be an object");
    } else {
      if (typeof db.enabled !== "boolean") fail("$.database.enabled", "is required and must be a boolean");
      if (db.enabled) {
        if (db.engine !== "postgres") fail("$.database.engine", "must be 'postgres' (only supported engine)");
        if (typeof db.composeService !== "string" || !SHORT_NAME_RE.test(db.composeService)) fail("$.database.composeService", `must match ${SHORT_NAME_RE}`);
        if (typeof db.containerDatabase !== "string" || db.containerDatabase.length === 0) fail("$.database.containerDatabase", "is required");
        if (db.containerUser !== undefined && typeof db.containerUser !== "string") fail("$.database.containerUser", "must be a string");
        if (db.backup !== undefined) {
          if (!isPlainObject(db.backup)) fail("$.database.backup", "must be an object");
          else {
            if (db.backup.enabled !== undefined && typeof db.backup.enabled !== "boolean") fail("$.database.backup.enabled", "must be a boolean");
            if (db.backup.retentionDays !== undefined && !(Number.isInteger(db.backup.retentionDays) && db.backup.retentionDays >= 1)) {
              fail("$.database.backup.retentionDays", "must be an integer >= 1");
            }
          }
        }
        if (!isPlainObject(db.migration)) {
          fail("$.database.migration", "is required when database.enabled is true");
        } else {
          if (typeof db.migration.service !== "string" || !SHORT_NAME_RE.test(db.migration.service)) fail("$.database.migration.service", `must match ${SHORT_NAME_RE}`);
          if (typeof db.migration.command !== "string" || db.migration.command.length === 0) fail("$.database.migration.command", "is required");
        }
        if (db.reset !== undefined && (!isPlainObject(db.reset) || typeof db.reset.command !== "string" || db.reset.command.length === 0)) {
          fail("$.database.reset.command", "must be a non-empty string when database.reset is present");
        }
        if (db.seed !== undefined && (!isPlainObject(db.seed) || typeof db.seed.command !== "string" || db.seed.command.length === 0)) {
          fail("$.database.seed.command", "must be a non-empty string when database.seed is present");
        }
      }
    }
  }

  // healthChecks
  if (config.healthChecks !== undefined) {
    if (!Array.isArray(config.healthChecks)) {
      fail("$.healthChecks", "must be an array");
    } else {
      config.healthChecks.forEach((hc, i) => {
        const p = `$.healthChecks[${i}]`;
        if (!isPlainObject(hc)) { fail(p, "must be an object"); return; }
        if (typeof hc.name !== "string" || hc.name.length === 0) fail(`${p}.name`, "is required");
        if (hc.type !== "http" && hc.type !== "compose") fail(`${p}.type`, "must be 'http' or 'compose'");
        if (hc.type === "http" && (typeof hc.url !== "string" || !/^https?:\/\//.test(hc.url))) fail(`${p}.url`, "is required for type 'http'");
        if (hc.type === "compose") {
          if (typeof hc.service !== "string" || !SHORT_NAME_RE.test(hc.service)) fail(`${p}.service`, `is required and must match ${SHORT_NAME_RE}`);
          if (typeof hc.command !== "string" || hc.command.length === 0) fail(`${p}.command`, "is required for type 'compose'");
        }
        if (hc.retries !== undefined && !(Number.isInteger(hc.retries) && hc.retries >= 1)) fail(`${p}.retries`, "must be an integer >= 1");
        if (hc.intervalSeconds !== undefined && !(Number.isInteger(hc.intervalSeconds) && hc.intervalSeconds >= 1)) fail(`${p}.intervalSeconds`, "must be an integer >= 1");
      });
    }
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const raw = await readStdin();
let config;
try {
  config = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON input: ${e.message}`);
  process.exit(1);
}

validate(config);

if (errors.length > 0) {
  console.error(`Deploy configuration is invalid (${errors.length} issue(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(config));
