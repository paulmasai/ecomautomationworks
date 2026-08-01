# Containers and GitHub Container Registry

## Purpose

The container provides a reproducible local and CI runtime for this Cloudflare Worker. It runs Wrangler's local Worker runtime on port `8787`.

Cloudflare does not deploy this Docker image. Production and staging Worker deployments continue to use the Wrangler deployment commands documented in the repository.

## Security properties

- The Node 22 base image is pinned to an immutable official multi-platform digest.
- The process runs as the unprivileged `node` user.
- `npm ci`, strict TypeScript checking, all mocked tests, and a Wrangler dry-run build must succeed while the image is built.
- `.dev.vars`, `.env` files, Git metadata, local dependencies, logs, coverage output, and the specification PDF are excluded from the build context.
- No build arguments, layers, labels, or workflow settings contain application credentials.
- The GitHub workflow uses the repository-scoped `GITHUB_TOKEN`; no long-lived registry token is stored.
- GitHub Actions and Docker Actions are pinned to immutable commit SHAs.
- Published multi-platform images include BuildKit provenance and an SBOM attestation.
- The workflow reports a `container/publish` commit status linked to the private Actions run.

## Build locally

```bash
docker build --target runtime --tag mobdeals-meta-automation-suite:local .
```

The Docker build runs the complete repository verification suite. A failed check prevents image creation.

## Configure the local Worker

Copy `.env.example` to the ignored `.dev.vars` file and replace every placeholder. For a non-outbound smoke test, dummy values are acceptable if they satisfy validation. Keep both outbound controls disabled:

```dotenv
OUTBOUND_ACTIONS_ENABLED=false
```

The checked-in database seed also keeps `global_automation_enabled`, posting, comment replies, and Messenger replies disabled.

## Run locally

Mount `.dev.vars` read-only so credentials never enter the image:

```bash
docker run --rm \
  --name mobdeals-meta-automation \
  --publish 8787:8787 \
  --mount type=bind,source="$(pwd)/.dev.vars",target=/app/.dev.vars,readonly \
  mobdeals-meta-automation-suite:local
```

In another terminal:

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/health
```

Stop the foreground process with `Ctrl+C`. The container is configured with a Docker health check against the same endpoint.

## Published image

The GitHub Actions workflow publishes to:

```text
ghcr.io/verseexplainer-dotcom/meta-automation-suite
```

Each successful `main` workflow publishes these tags:

- `latest`
- `main`
- `sha-<short-commit>`

A deliberate Git tag such as `v0.2.0` additionally publishes `v0.2.0`, `0.2.0`, and `0.2`. The workflow builds `linux/amd64` and `linux/arm64` variants under one manifest digest.

Pull a public image with:

```bash
docker pull ghcr.io/verseexplainer-dotcom/meta-automation-suite:latest
```

For a private image, authenticate with a GitHub classic personal access token that has `read:packages`; never place the token in shell history or a repository file.

## Publication workflow

`.github/workflows/container.yml` runs on:

- pushes to `main`;
- Git tags beginning with `v`;
- manual workflow dispatch.

The workflow requires GitHub Actions to be enabled and the organization to allow the repository `packages: write` permission. A package created by the workflow normally inherits repository visibility and access. Organization policy can override this behavior.

## Troubleshooting

- A `500` health response means one or more required `.dev.vars` values failed runtime validation.
- A missing or unreadable `.dev.vars` mount leaves application secrets unbound.
- A GHCR `permission_denied` workflow failure usually means organization Actions/package policy must be changed by an owner.
- A local private-image pull requires `read:packages` permission and organization SSO authorization where applicable.
- Meta, Supabase, and Cloudflare production results cannot be inferred from a successful local container smoke test.
