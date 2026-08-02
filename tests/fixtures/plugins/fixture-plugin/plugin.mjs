// Minimal plugin used only by tests/unit/plugin-loader.test.mjs — exercises one default, one
// validate() rule, and one hook, without depending on any real framework.
export default {
  name: "fixture-plugin",
  defaults: {
    database: {
      containerUser: "fixture-default-user",
    },
  },
  hooks: {
    pre_migration: "echo fixture-plugin pre_migration",
  },
  validate(config) {
    const issues = [];
    if (config.database?.enabled && !config.database?.containerDatabase) {
      issues.push("fixture-plugin requires database.containerDatabase when database is enabled");
    }
    return issues;
  },
};
