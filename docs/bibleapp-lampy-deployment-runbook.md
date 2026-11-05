# BibleApp on Lampy — deployment runbook

Status date: 2026-11-04. This runbook is a staged deployment plan, not a
claim that the API is already deployed.

## Architecture

- PostgreSQL database: `bible_app`, on Lampy, localhost only.
- Database role: `bible_app_api`, restricted to the API's required tables
  and columns.
- API: Express 5, localhost port 8799, routes under `/api/bible/*`.
- Apache: existing front door; add only an `/api/` reverse-proxy mapping.
- Existing Flask Bible app remains at `/bible/` on port 5057.
- Existing forum remains at `/app/` on port 8000.

Do not expose PostgreSQL port 5432. Do not make the sandbox-token API
publicly reachable. A tailnet-only route is acceptable for sandbox use.

## Runtime choice

Use a Linux Node.js LTS runtime installed inside the WSL `lampy` distro.
This is preferred over using Windows Node from a WSL-managed Supervisor
service: it keeps process lifecycle, filesystem paths, localhost networking,
and service supervision in one OS environment.

Before installing, record the current distro version and package source,
choose a supported LTS release, and verify `node --version`,
`npm --version`, and Corepack/pnpm. Do not replace or remove the Windows
Node installation.

## Application checkout and build

Use a dedicated deployment directory, for example `/opt/bible-app-api`.
Do not deploy into `/opt/bible`, which contains the legacy Flask app.

- Fetch `feat/bible-app-legacy-db-adapter` from
  `kitcosby/BibleApp`.
- Preserve the repository's `pnpm-lock.yaml`; use frozen-lockfile
  installation.
- Build workspace project references with `tsc -b`, then build the API
  package with its `build` script.
- Confirm `artifacts/api-server/dist/index.mjs` exists.
- Run the package's start command in a foreground smoke test with a
  non-production/sandbox environment before adding Supervisor.

Do not run Drizzle schema push or migrations.

## Environment and launcher

The existing environment file is reported at
`/root/bible-app-api.env`, root-owned and mode 0600. It contains the
database URL, sandbox token, and port. Never print it, copy it into Git,
place it in an Apache-readable directory, or embed values in Supervisor
configuration.

Create a root-owned launcher script with mode 0700 that:
1. enables automatic export of sourced variables,
2. sources `/root/bible-app-api.env`,
3. disables automatic export, and
4. execs the Linux Node binary against
   `/opt/bible-app-api/artifacts/api-server/dist/index.mjs`.

Supervisor currently runs as root and its active configuration is
`/etc/supervisor/conf.d/lampy.conf`. Add one new `[program:bible-app-api]`
entry that invokes the launcher, uses `autorestart=true`, and writes
separate stdout/stderr logs under `/var/log/supervisor/`. Do not create a
second supervisord process. Before applying, back up the config and inspect
the current process list/status.

## Apache reverse proxy

The current Apache site config contains the existing `/app` and
`/bible` proxy mappings. Add these mappings without changing them:

```apache
ProxyPass        /api/ http://127.0.0.1:8799/api/
ProxyPassReverse /api/ http://127.0.0.1:8799/api/
```

Keep the mapping in the active site/vhost configuration after the required
proxy modules are enabled. Validate with `apache2ctl configtest` before
reloading Apache. Do not restart the full Lampy stack.

## Verification gates

1. Linux Node runtime is installed and version recorded.
2. Workspace install/build succeeds from a clean checkout.
3. API responds on `127.0.0.1:8799`; no listener is bound to
   `0.0.0.0` or a public interface.
4. The API health endpoint returns a database-connected result when called
   with the sandbox token.
5. Missing/incorrect token receives 403.
6. Read endpoints return the expected two baseline translations.
7. A controlled write/read-back/cleanup test passes and restores the
   original database snapshot.
8. Apache configtest succeeds; only then reload Apache.
9. The `/api/` path works through the intended tailnet ingress while
   `/bible/` and `/app/` remain healthy.
10. Supervisor reports the API program RUNNING and all pre-existing
    programs remain RUNNING.

Capture command output and timestamps in a deployment log. Distinguish
attempted, changed, committed, and verified states.

## Production readiness — separate gate

Before any public exposure:
- Replace sandbox-token authorization with real user authentication.
- Enforce per-user ownership on every translation read and mutation.
- Review CORS, rate limits, request-size limits, session/token lifecycle,
  audit logging, and secret rotation.
- Review the API's option-index allocation for concurrent writes.
- Review whether health checks should reveal database status.
- Complete a threat-model review.

## Explicitly deferred

Do not change PostgreSQL-wide local authentication rules or cross-database
CONNECT grants as part of this deployment. They may affect forum and pgai
workers and require a separate impact assessment.
