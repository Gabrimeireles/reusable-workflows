// Resolves declared plugins into the final config: merges defaults (config always wins, later
// plugin wins among plugins), runs each plugin's validate(), and folds in default hooks/health
// checks. See docs/adr/0007-plugin-architecture.md. Pure module — no process.exit, no I/O beyond
// the dynamic import() of plugin files, so it's directly unit-testable.
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Merges `source` into `target`. When `arraysUnion` is true, array fields present in both are
// concatenated and deduplicated (by JSON equality) rather than one replacing the other — used
// only while accumulating defaults across multiple plugins. The final application of the
// caller's own config always uses `arraysUnion: false` (the caller's array fully replaces any
// plugin-contributed one when the caller declares the field at all), per FR-012.
function deepMerge(target, source, { arraysUnion }) {
  if (!isPlainObject(source)) return source === undefined ? target : source;
  if (!isPlainObject(target)) target = {};
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value) && Array.isArray(target[key])) {
      if (arraysUnion) {
        const seen = new Set(target[key].map((v) => JSON.stringify(v)));
        result[key] = [...target[key]];
        for (const item of value) {
          const k = JSON.stringify(item);
          if (!seen.has(k)) {
            seen.add(k);
            result[key].push(item);
          }
        }
      } else {
        result[key] = value;
      }
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      result[key] = deepMerge(target[key], value, { arraysUnion });
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function loadPlugin(pluginsDir, name) {
  const namePattern = /^[a-z][a-z0-9-]{0,31}$/;
  if (!namePattern.test(name)) {
    throw new PluginError(`invalid plugin name '${name}' (must match ${namePattern})`);
  }
  const pluginPath = path.join(pluginsDir, name, "plugin.mjs");
  if (!fs.existsSync(pluginPath)) {
    throw new PluginError(`unknown plugin '${name}' (no such file: ${pluginPath})`);
  }
  const mod = await import(pathToFileURL(pluginPath).href);
  const plugin = mod.default;
  if (!isPlainObject(plugin)) {
    throw new PluginError(`plugin '${name}' does not export a default object`);
  }
  return plugin;
}

export class PluginError extends Error {}

/**
 * @param {object} config - the caller's own (structurally valid) config
 * @param {string} pluginsDir - absolute path to the directory containing one folder per plugin
 * @returns {Promise<{ config: object, issues: string[] }>}
 */
export async function resolvePlugins(config, pluginsDir) {
  const declared = config.plugins || [];
  const issues = [];
  let accumulatedDefaults = {};
  const loadedPlugins = [];

  for (const name of declared) {
    let plugin;
    try {
      plugin = await loadPlugin(pluginsDir, name);
    } catch (e) {
      issues.push(e.message);
      continue;
    }
    loadedPlugins.push(plugin);
    if (plugin.defaults) {
      accumulatedDefaults = deepMerge(accumulatedDefaults, plugin.defaults, { arraysUnion: true });
    }
    if (plugin.hooks) {
      accumulatedDefaults = deepMerge(
        accumulatedDefaults,
        { hooks: plugin.hooks },
        { arraysUnion: true }
      );
    }
    if (plugin.healthChecks) {
      accumulatedDefaults = deepMerge(
        accumulatedDefaults,
        { healthChecks: plugin.healthChecks },
        { arraysUnion: true }
      );
    }
  }

  // The caller's own config always wins — full replace for anything it declares, including
  // arrays/objects; plugin defaults only fill fields the caller left unset.
  const merged = deepMerge(accumulatedDefaults, config, { arraysUnion: false });

  for (const plugin of loadedPlugins) {
    if (typeof plugin.validate === "function") {
      const pluginIssues = plugin.validate(merged) || [];
      for (const issue of pluginIssues) {
        issues.push(`${plugin.name || "?"}: ${issue}`);
      }
    }
  }

  return { config: merged, issues };
}
