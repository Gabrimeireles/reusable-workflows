# Idas-Vindas Reusable Workflows

Reusable GitHub Actions workflows for org-wide CI/CD.

## Available workflows
- `.github/workflows/docker-build.yml`
- `.github/workflows/swagger-pages.yml`
- `.github/workflows/github-release.yml`
- `.github/workflows/docker-deploy-ssh.yml`

## Usage example
```yaml
jobs:
  build:
    uses: Idas-Vindas/reusable-workflows/.github/workflows/docker-build.yml@v1
    with:
      image_name: my-api
```

## Versioning
Use immutable tags (`v1`, `v1.0.0`) in caller repositories.
