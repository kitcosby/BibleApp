# BibleApp Lampy deployment log

Date: 2026-11-05 UTC
Repository: `kitcosby/BibleApp`
Branch: `feat/bible-app-legacy-db-adapter`
Deployed source commit: `8acc7c330189c25e7526f2c1efa74fecafa6d2e2`
Target: Lampy WSL, Ubuntu 22.04.5 LTS

## Changes made

- Installed Node.js 24.22.1 LTS under `/opt/node-v24.22.1-linux-x64`.
- Cloned to `/opt/bible-app-api` using a dedicated read-only deploy key.
- Generated and verified a separate write-capable deploy key using `git push --dry-run`;
  no repository content was pushed during that test.
- Installed and linked 449 workspace packages from the frozen lockfile.
- Built the API package and passed workspace library and API TypeScript checks.
- Added root-owned launcher `/usr/local/bin/bible-app-api-start` (mode 0700).
- Added Supervisor program `bible-app-api` to the existing Supervisor configuration.
- Added Apache `/api/` reverse-proxy mapping to localhost port 8799.
- Backed up Supervisor and Apache configs before editing.

## Verification

- `apache2ctl configtest`: `Syntax OK`.
- Apache graceful reload completed.
- Supervisor: `bible-app-api` RUNNING; all eight pre-existing programs remained RUNNING.
- Public API health: HTTP 200.
- Authenticated database health: `{"status":"ok","database":"connected"}`.
- Missing sandbox token: HTTP 403.
- Translations read: KJV and Young's Literal baseline records returned.
- Through the laptop's Tailscale IPv4 address, `/api/healthz`, `/bible/`, and `/app/` returned HTTP 200.
- No database writes, migrations, schema changes, or data modifications.

## Known follow-up

The frozen-lockfile install downloaded and linked all 449 packages but returned
`ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`. The esbuild binary was verified at
version 0.28.2; the API build and typechecks passed. Resolve the pnpm build-script
approval discrepancy without weakening supply-chain protections.

The API still uses sandbox-token authorization, not production user authentication.
The tested Tailscale address is not evidence that public-internet access is blocked;
verify ingress/firewall policy before claiming tailnet-only isolation or enabling broader access.