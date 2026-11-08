# BibleApp on Lampy — deployment runbook

Status date: 2026-11-05. The sandbox API is deployed on Lampy under Supervisor
and reverse-proxied by Apache. This is not a production-authenticated release.

## Architecture

- PostgreSQL database: `bible_app`, on Lampy, localhost only.
- Database role: `bible_app_api`, restricted to the API's required tables and columns.
- API: Express 5, localhost port 8799, routes under `/api/bible/*`.
- Apache: `/api/` reverse-proxies to `127.0.0.1:8799`.
- Existing Flask Bible app remains at `/bible/` on port 5057.
- Existing forum remains at `/app/` on port 8000.
- API service is managed by the existing Supervisor instance as `bible-app-api`.

Do not expose PostgreSQL port 5432. The API currently uses sandbox-token authorization,
not production user authentication. Keep it restricted to trusted tailnet access;
public production exposure is not approved.

## Runtime and host preparation

- Lampy is Ubuntu 22.04.5 LTS.
- Node.js 24.22.1 LTS is installed under `/opt/node-v24.22.1-linux-x64`, with
  `/opt/node` and `/usr/local/bin` symlinks. Its SHA-256 was verified against
  the official Node.js release checksum before extraction.
- Verified versions: Node 24.22.1, npm 11.19.1, Corepack 0.36.0.
- Separate Ed25519 deploy keys are installed on Lampy:
  - `/root/.ssh/bibleapp_deploy` — read-only fetch key.
  - `/root/.ssh/bibleapp_deploy_write` — write-capable repository key.
- Keep both private keys on Lampy; never paste or commit them.

## Application checkout and build

- Checkout: `/opt/bible-app-api`.
- Branch: `feat/bible-app-legacy-db-adapter`.
- Deployed source commit: `8acc7c330189c25e7526f2c1efa74fecafa6d2e2`.
- Frozen-lockfile install downloaded and linked 449 packages across 9 workspace projects.
- pnpm returned `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`. The installed
  executable was verified at version 0.28.2; API build and TypeScript checks passed.
- `pnpm run typecheck:libs` passed (`tsc --build`). API package typecheck passed.
- API package build passed and generated `artifacts/api-server/dist/index.mjs` and source maps.
- Resolve the pnpm build-script approval discrepancy without weakening supply-chain protections.
- No Drizzle schema push, migrations, or application source changes were made on the deployment checkout.

## Environment and launcher

- Environment file: `/root/bible-app-api.env`, root-owned, mode 0600.
- It contains the database URL, sandbox token, and port. Never print it, copy it into Git,
  place it in an Apache-readable directory, or embed values in Supervisor configuration.
- Launcher: `/usr/local/bin/bible-app-api-start`, root-owned, mode 0700.
- The launcher sources the environment file and execs the Linux Node binary against
  `/opt/bible-app-api/artifacts/api-server/dist/index.mjs`.
- Supervisor config: `/etc/supervisor/conf.d/lampy.conf`.
- `[program:bible-app-api]` invokes the launcher, uses `autorestart=true`, and writes
  separate stdout/stderr logs under `/var/log/supervisor/`.
- The API is RUNNING under the existing Supervisor instance; all eight pre-existing
  Supervisor programs remained RUNNING.

## Apache reverse proxy

The active site config is `/etc/apache2/sites-available/lampy.conf`. These mappings
were added without changing the existing `/app` and `/bible` mappings:

```apache
ProxyPass        /api/ http://127.0.0.1:8799/api/
ProxyPassReverse /api/ http://127.0.0.1:8799/api/
```

Both `proxy_module` and `proxy_http_module` are loaded. `apache2ctl configtest`
returned `Syntax OK`; Apache was gracefully reloaded, not restarted.
Backups were created before editing:
`/etc/supervisor/conf.d/lampy.conf.pre-bible-api` and
`/etc/apache2/sites-available/lampy.conf.pre-bible-api`.

## Verification results — 2026-11-05 UTC

1. Checkout commit verified; working tree clean.
2. API build and TypeScript checks passed.
3. Public `/api/healthz` returned HTTP 200.
4. Authenticated `/api/bible/healthz` returned
   `{"status":"ok","database":"connected"}`.
5. Missing sandbox token returned HTTP 403.
6. Authenticated `/api/bible/translations` returned the existing KJV and Young's Literal records.
7. Through the laptop's Tailscale IPv4 address, `/api/healthz` returned HTTP 200.
8. Existing `/bible/` and `/app/` paths each returned HTTP 200 through the same Tailscale address.
9. Supervisor reported `bible-app-api` RUNNING; all eight pre-existing programs also remained RUNNING.
10. No database writes, migrations, schema changes, or data modifications were performed.

The Tailscale address was tested. Public-internet reachability was not tested; do not infer
that the API is safe for public exposure or that ingress is tailnet-only.

## Production readiness — separate gate

Before any public exposure:
- Replace sandbox-token authorization with real user authentication.
- Enforce per-user ownership on every translation read and mutation.
- Review CORS, rate limits, request-size limits, token lifecycle, audit logging, and secret rotation.
- Review the API's option-index allocation for concurrent writes.
- Review whether health checks should reveal database status.
- Complete a threat-model review.
- Confirm ingress/firewall policy explicitly permits only intended tailnet clients before
  treating the route as tailnet-only.

## Explicitly deferred

Do not change PostgreSQL-wide local authentication rules or cross-database CONNECT grants
as part of this deployment. They may affect forum and pgai workers and require a separate
impact assessment.