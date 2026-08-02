# Writing a Plugin

## 1. Create the file

`.github/plugins/<name>/plugin.mjs`, default-exporting a plain object:

```js
export default {
  name: "my-plugin",
  defaults: {
    // A partial deploy config — anything here fills a gap the caller's own config left unset.
    // Never touches `images`, `project`, or anything else that's inherently project-specific.
  },
  hooks: {
    // Optional default commands for any of the 12 lifecycle hooks (docs/hooks.md).
    pre_migration: "some-generic-command",
  },
  healthChecks: [
    // Optional default health check entries.
  ],
  validate(config) {
    // Optional. Receives the FULLY MERGED config (after all plugins' defaults and the
    // caller's own values are applied). Return an array of issue strings, or [] / undefined.
    const issues = [];
    if (config.database?.enabled && config.database?.engine !== "my-engine") {
      issues.push("declared but database.engine is not 'my-engine'");
    }
    return issues;
  },
};
```

`name` must match the directory name and satisfy `^[a-z][a-z0-9-]{0,31}$`.

## 2. What NOT to put in a plugin

Per [`docs/adr/0007-plugin-architecture.md`](adr/0007-plugin-architecture.md), a plugin can only
default/validate/extend **data** the platform already understands (config fields, hooks, health
checks). It cannot:
- Add a new secret.
- Add a new remote execution mechanism.
- Reference anything outside the merged config object it's given.

If you need a genuinely new mechanism (e.g. a new database engine's backup process), that's a
composite action + schema change first — plugins can only default into mechanisms that already
exist.

## 3. Test it

Add a fixture under `tests/fixtures/plugins/<name>/plugin.mjs` if you want an isolated unit test
(see `tests/fixtures/plugins/fixture-plugin/`), or test the real shipped plugin directly — every
plugin under `.github/plugins/` is automatically covered by
`tests/unit/plugin-loader.test.mjs`'s "shipped plugin loads and exports the expected shape" loop.
Add a specific test alongside it for anything your plugin's `validate()` should catch:

```js
test("my-plugin requires database.engine my-engine", async () => {
  const { issues } = await resolvePlugins(
    { plugins: ["my-plugin"], database: { enabled: true, engine: "something-else" } },
    REAL_PLUGINS_DIR
  );
  assert.equal(issues.length, 1);
});
```

Run `node --test tests/unit/plugin-loader.test.mjs`.

## 4. Document it

Add a row to the table in [`docs/plugins.md`](plugins.md).
