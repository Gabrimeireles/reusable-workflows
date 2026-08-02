// Prisma: default migration/reset/seed commands and a pre_migration hook that regenerates the
// client. The caller still owns `database.migration.service` (which Compose service runs it) —
// that's genuinely project-specific and not something a plugin can guess. Requires the
// `postgres` (or another database) plugin, or the caller's own `database` block, to actually
// enable a database — this plugin only supplies commands, never `database.enabled`.
export default {
  name: "prisma",
  defaults: {
    database: {
      migration: { command: "npx prisma migrate deploy" },
      reset: { command: "npx prisma migrate reset --force --skip-seed" },
      seed: { command: "npx prisma db seed" },
    },
    hooks: {
      pre_migration: "npx prisma generate",
    },
  },
  validate(config) {
    const issues = [];
    if (config.database?.enabled && !config.database?.migration?.service) {
      issues.push(
        "requires database.migration.service (which Compose service runs Prisma) — this plugin only supplies the command"
      );
    }
    return issues;
  },
};
