// Postgres conventions: sane backup defaults, and a validation rule tying `plugins: [postgres]`
// to `database.engine: postgres` so a caller can't declare the plugin against a mismatched
// engine without an explicit, actionable error.
export default {
  name: "postgres",
  defaults: {
    // `enabled: true` because declaring this plugin at all is the caller opting into a Postgres
    // database — without this default, a caller who only sets containerDatabase/migration would
    // fail schema validation on the missing required `database.enabled` field.
    database: {
      enabled: true,
      engine: "postgres",
      composeService: "postgres",
      containerUser: "postgres",
      backup: {
        enabled: true,
        retentionDays: 14,
      },
    },
  },
  validate(config) {
    const issues = [];
    if (config.database?.enabled && config.database?.engine !== "postgres") {
      issues.push(
        `declared but database.engine is '${config.database?.engine}', not 'postgres'`
      );
    }
    return issues;
  },
};
