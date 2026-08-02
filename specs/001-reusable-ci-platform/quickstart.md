# Quickstart: Adding a New Project

(Full version maintained at `docs/adding-a-project.md`; this is the Phase 1 design sketch.)

1. In your project repo, add `.github/deploy/<environment>.yml` describing images, compose file,
   database (if any), and health checks — see `specs/001-reusable-ci-platform/contracts/config.schema.json`.
2. Add the required secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `GHCR_PAT`, and one
   secret per env file your config declares) as repository secrets.
3. Write `.github/workflows/deploy.yml`: triggers + `permissions:` + one job per image calling
   `docker-build.yml`, then a `deploy` job calling `deploy-stack.yml` with `secrets: inherit`.
4. Push to your default branch (or run `workflow_dispatch`) and watch the run summary.
5. (Optional) Add `validate-caller.yml` as a required PR status check so config mistakes fail
   fast on pull requests instead of on deploy.

No database, no Tailscale, and no health checks are all valid — every one of those blocks is
optional and independently skippable.
