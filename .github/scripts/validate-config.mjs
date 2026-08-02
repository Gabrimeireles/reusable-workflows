#!/usr/bin/env node
// Structural + semantic validator for the declarative deploy config
// (.github/schema/deploy-config.schema.json is the documented source of truth this
// mirrors). Deliberately dependency-free (no ajv/jsonschema) — see
// docs/adr/0003-config-model.md and specs/001-reusable-ci-platform/research.md R5. Iteration 2
// (docs/adr/0007-plugin-architecture.md) adds plugin resolution and filesystem/Compose-aware
// semantic checks — see the "Update (Iteration 2)" note in ADR 0003.
//
// Usage: node validate-config.mjs < config.json
// Reads JSON on stdin (the caller is expected to convert YAML -> JSON with `yq` first). Resolves
// plugins first (so their defaults can satisfy required fields), then runs structural checks on
// the merged config, then semantic checks against the current working directory (expected to be
// the checked-out caller repository root).
// On success: prints the merged config as compact JSON on stdout, exits 0.
// On failure: prints every error found, one per line, to stderr, exits 1.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePlugins } from "./lib/plugin-loader.mjs";

const NAME_RE = /^[a-z][a-z0-9-]{1,48}$/;
const SHORT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const IMAGE_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SECRET_LABEL_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_FILENAME_RE = /^\.[a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
const COMPOSE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
// Deliberately does NOT match bare "KEY" — that would also reject genuinely public values whose
// name ends in _KEY by convention (e.g. Stripe's VITE_STRIPE_PUBLISHABLE_KEY, a VAPID public
// key). It matches the shapes that are actually secret: *_SECRET(_KEY)?, *_TOKEN, *_PASSWORD,
// *_PRIVATE_KEY, *_API_KEY, *_ACCESS_KEY.
const SECRET_LOOKING_KEY_RE = /SECRET|TOKEN|PASSWORD|PRIVATE_?KEY|API_?KEY|ACCESS_?KEY/i;
const MAX_ENV_FILES = 6;
const MAX_HEALTH_CHECKS = 4;
const HOOK_NAMES = [
  "pre_build",
  "post_build",
  "pre_backup",
  "post_backup",
  "pre_migration",
  "post_migration",
  "pre_deploy",
  "post_deploy",
  "pre_healthcheck",
  "post_healthcheck",
  "pre_cleanup",
  "post_cleanup",
];
const PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins");

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
    "plugins",
    "hooks",
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
          if (SECRET_LOOKING_KEY_RE.test(k)) fail(`${p}.buildArgs.${k}`, "build arg keys must not look like a secret (matches SECRET/TOKEN/PASSWORD/PRIVATE_KEY/API_KEY/ACCESS_KEY)");
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
      const seenDestinations = new Map();
      config.environmentFiles.forEach((ef, i) => {
        const p = `$.environmentFiles[${i}]`;
        if (!isPlainObject(ef)) { fail(p, "must be an object"); return; }
        if (typeof ef.secret !== "string" || !SECRET_LABEL_RE.test(ef.secret)) fail(`${p}.secret`, `must match ${SECRET_LABEL_RE} (documentation label only)`);
        if (typeof ef.destination !== "string" || !ENV_FILENAME_RE.test(ef.destination)) {
          fail(`${p}.destination`, `must match ${ENV_FILENAME_RE}`);
        } else if (seenDestinations.has(ef.destination)) {
          fail(`${p}.destination`, `duplicate destination '${ef.destination}' (also used by entry ${seenDestinations.get(ef.destination)}) — one would silently overwrite the other`);
        } else {
          seenDestinations.set(ef.destination, i);
        }
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
    } else if (config.healthChecks.length > MAX_HEALTH_CHECKS) {
      fail("$.healthChecks", `supports at most ${MAX_HEALTH_CHECKS} entries (the reusable workflow has ${MAX_HEALTH_CHECKS} inline slots — see docs/adr's clarify-log Q2)`);
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

  // plugins (names only — existence of the plugin directory is checked during resolution,
  // before this structural pass even runs; see the bottom of this file)
  if (config.plugins !== undefined) {
    if (!Array.isArray(config.plugins)) {
      fail("$.plugins", "must be an array of plugin names");
    } else {
      const seen = new Set();
      config.plugins.forEach((name, i) => {
        if (typeof name !== "string" || !SHORT_NAME_RE.test(name)) {
          fail(`$.plugins[${i}]`, `must match ${SHORT_NAME_RE}`);
        } else if (seen.has(name)) {
          fail(`$.plugins[${i}]`, `duplicate plugin '${name}'`);
        } else {
          seen.add(name);
        }
      });
    }
  }

  // hooks
  if (config.hooks !== undefined) {
    if (!isPlainObject(config.hooks)) {
      fail("$.hooks", "must be an object");
    } else {
      for (const [hookName, value] of Object.entries(config.hooks)) {
        const p = `$.hooks.${hookName}`;
        if (!HOOK_NAMES.includes(hookName)) {
          fail(p, `unknown hook name (must be one of: ${HOOK_NAMES.join(", ")})`);
          continue;
        }
        const isInlineCommand = typeof value === "string" && value.length > 0;
        const isScriptRef = isPlainObject(value) && typeof value.script === "string" && value.script.length > 0;
        if (!isInlineCommand && !isScriptRef) {
          fail(p, "must be a non-empty command string, or an object { script: '<path>' }");
        }
      }
    }
  }
}

// Semantic checks that need the checked-out caller repository on disk (Iteration 2 — spec.md
// User Story 5). `cwd` is expected to be the caller repository root, which is true whenever this
// script runs as part of `load-config` (checkout always happens first in every workflow that
// calls it).
function validateSemantics(config, cwd) {
  if (!isPlainObject(config)) return;

  if (isPlainObject(config.compose) && typeof config.compose.source === "string") {
    const composePath = path.resolve(cwd, config.compose.source);
    if (!fs.existsSync(composePath)) {
      fail("$.compose.source", `file does not exist: '${config.compose.source}'`);
    }
  }

  if (Array.isArray(config.images)) {
    config.images.forEach((img, i) => {
      if (!isPlainObject(img)) return;
      const p = `$.images[${i}]`;
      if (typeof img.dockerfile === "string" && !fs.existsSync(path.resolve(cwd, img.dockerfile))) {
        fail(`${p}.dockerfile`, `file does not exist: '${img.dockerfile}'`);
      }
      if (typeof img.context === "string" && !fs.existsSync(path.resolve(cwd, img.context))) {
        fail(`${p}.context`, `directory does not exist: '${img.context}'`);
      }
    });
  }

  // Cross-check every referenced service name against the Compose file's own `services:` keys.
  // Only attempted when the Compose file itself exists (already reported above otherwise).
  let composeServices = null;
  if (isPlainObject(config.compose) && typeof config.compose.source === "string") {
    const composePath = path.resolve(cwd, config.compose.source);
    if (fs.existsSync(composePath)) {
      try {
        const out = execFileSync("yq", ["-o=json", "eval", ".services | keys", composePath], {
          encoding: "utf8",
        });
        composeServices = new Set(JSON.parse(out || "[]"));
      } catch {
        fail("$.compose.source", `could not be parsed as a Compose file with a 'services:' map: '${config.compose.source}'`);
      }
    }
  }

  function checkServiceRef(refPath, serviceName) {
    if (typeof serviceName !== "string" || !composeServices) return;
    if (!composeServices.has(serviceName)) {
      fail(refPath, `service '${serviceName}' is not declared under 'services:' in ${config.compose?.source}`);
    }
  }

  if (isPlainObject(config.compose)) {
    (config.compose.dependencyServices || []).forEach((s, i) =>
      checkServiceRef(`$.compose.dependencyServices[${i}]`, s)
    );
    (config.compose.applicationServices || []).forEach((s, i) =>
      checkServiceRef(`$.compose.applicationServices[${i}]`, s)
    );
  }
  if (isPlainObject(config.database) && config.database.enabled) {
    checkServiceRef("$.database.composeService", config.database.composeService);
    if (isPlainObject(config.database.migration)) {
      checkServiceRef("$.database.migration.service", config.database.migration.service);
    }
  }
  (config.healthChecks || []).forEach((hc, i) => {
    if (isPlainObject(hc) && hc.type === "compose") {
      checkServiceRef(`$.healthChecks[${i}].service`, hc.service);
    }
  });

  // plugin existence is checked during resolution (before this function runs), but a plugin
  // declared with a name that fails the SHORT_NAME_RE pattern never reaches resolution — that's
  // already reported by the structural check above, nothing further needed here.
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
let rawConfig;
try {
  rawConfig = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON input: ${e.message}`);
  process.exit(1);
}

// Resolve plugins first, so their defaults can satisfy fields the structural pass requires
// (e.g. the `postgres` plugin defaulting `database.enabled: true`). If `plugins` isn't even an
// array, skip resolution silently here — the structural pass below reports the type error.
const declaredPlugins = Array.isArray(rawConfig?.plugins) ? rawConfig.plugins : [];
const { config, issues: pluginIssues } = declaredPlugins.length
  ? await resolvePlugins(rawConfig, PLUGINS_DIR)
  : { config: rawConfig, issues: [] };

for (const issue of pluginIssues) fail("$.plugins", issue);

validate(config);
validateSemantics(config, process.cwd());

if (errors.length > 0) {
  console.error(`Deploy configuration is invalid (${errors.length} issue(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(config));
