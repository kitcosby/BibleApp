# BibleApp

BibleApp is a pnpm workspace containing the Bible application development workspace, a small Express API service, shared API/database packages, and separate frontend prototype artifacts.

> **Current implementation status:** the checked-in API exposes a health endpoint, translation-authoring routes, and the Hebrew vowel-variant routes. The vowel-variant routes were verified live on Lampy against the isolated shadow database on 2026-11-12 (45 of 45 checks passed; see `docs/verification/2026-11-12-shadow-api/`). The Drizzle schema still has no application tables, and the `build-your-translation` frontend remains a prototype. This README documents what is present in the repository and what has been verified in deployment; it does not imply that a complete translation workflow is operational.

## Repository role

This is the development workspace and source tree for the BibleApp application family. It is distinct from the public `BibleApp-pwa` repository, which is a small static/offline PWA with its own deployment and service-worker model. Do not assume that the two repositories share a build pipeline or that one is automatically deployed from the other.

## Workspace layout

The root `pnpm-workspace.yaml` includes `artifacts/*`, `lib/*`, `lib/integrations/*`, and `scripts`.

| Path | Role | Current notes |
|---|---|---|
| `artifacts/api-server/` | Express API service | Express 5; mounts routes under `/api`: health (`GET /api/healthz`), translation-authoring routes under `/api/bible`, and Hebrew vowel-variant routes under `/api/lexicon/hebrew-vowel-variants`. |
| `artifacts/build-your-translation/` | Translation-app frontend artifact | React, Vite, Wouter, TanStack Query and shared UI components; current home route is a placeholder. |
| `artifacts/mockup-sandbox/` | Separate UI/mockup sandbox | Independent Vite artifact; do not treat it as the deployed application without deployment evidence. |
| `lib/api-spec/` | API contract source | OpenAPI 3.1 document and Orval configuration. |
| `lib/api-client-react/` | Generated/maintained React API client | Client code is generated from the API specification. |
| `lib/api-zod/` | API validation/types | Zod types generated from the API specification. |
| `lib/db/` | Database package | Drizzle ORM configuration and schema exports; current schema index contains no application tables. |
| `scripts/` | Workspace scripts | Small helper scripts; inspect before using in operational environments. |

## Technology

- Node.js 24, TypeScript 5.9, pnpm workspaces.
- Frontend artifacts use React 19 and Vite 7.
- API service uses Express 5 and Pino logging.
- Database package uses PostgreSQL with Drizzle ORM.
- API contract uses OpenAPI 3.1; Orval generates client and Zod artifacts.
- Workspace package catalog and dependency overrides are centralized in `pnpm-workspace.yaml`.

## Development commands

Run commands from the repository root with a compatible Node.js and pnpm installation.

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

Useful package-level commands:

```sh
pnpm --filter @workspace/build-your-translation run dev
pnpm --filter @workspace/build-your-translation run build
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-spec run codegen
```

The API server's `dev` script builds and then starts the service. It requires a positive `PORT` environment variable. Its health endpoint is `GET /api/healthz`.

The workspace's `replit.md` also documents `DATABASE_URL` and a Drizzle schema push command. Treat schema push as a development-only operation; do not run it against a production database without a reviewed migration plan and explicit authorization.

## API and database boundaries

- The OpenAPI source of truth is `lib/api-spec/openapi.yaml`.
- API routes are mounted under `/api` in `artifacts/api-server/src/app.ts`.
- The registered routes are `GET /api/healthz` (schema-validated health status), the translation-authoring routes under `/api/bible`, and the Hebrew vowel-variant routes under `/api/lexicon/hebrew-vowel-variants` (sandbox-token protected; read-only against the shadow database). The full inventory is in `docs/api-contract-inventory.md`.
- Generated API client and Zod files should be regenerated from the OpenAPI source rather than edited manually.
- Drizzle tables belong under `lib/db/src/schema/` and should be exported through the schema index.
- The current schema index contains only scaffolding comments and no application tables. Do not infer a live BibleApp data model from the package dependencies alone.

## Important distinctions

1. **BibleApp is not BibleApp-pwa.** The latter is a separate public static/offline PWA repository. Keep their release and deployment responsibilities distinct until the actual hosting configuration proves otherwise.
2. **Prototype code is not production functionality.** The translation frontend and mockup sandbox contain scaffold/prototype structure; their presence does not establish that user workflows are implemented.
3. **API packages are contract-first.** Update the OpenAPI source before regenerating API client and validation artifacts.
4. **Database changes are operationally sensitive.** Prefer reviewed migrations and backups over ad hoc schema pushes when a persistent environment is involved.

## Not yet established by this repository inspection

- Production hosting, domain routing, and deployment automation for this workspace.
- A complete authentication, authorization, translation editing, publishing, or synchronization workflow.
- A production PostgreSQL schema for BibleApp.

Verify these from deployment configuration and the running environment before documenting them as operational.

Established by deployment inspection (2026-11-12): the API server is deployed on Lampy under Supervisor (`bible-app-api`, port 8799) from a checkout of this repository, and the Hebrew vowel-variant routes serve the isolated shadow database `bible_hebrew_variant_shadow_20261107` through a read-only, production-fenced login. The deployed checkout can lag `main`; the dated verification record is in `docs/verification/2026-11-12-shadow-api/`.

## Related repositories

- [BibleApp-pwa](https://github.com/kitcosby/BibleApp-pwa) — separate public static/offline PWA.
- [bible-project](https://github.com/kitcosby/bible-project) — canonical Bible project repository.
- [Bible](https://github.com/kitcosby/Bible) — historical repository copy; preserve its history.

## Maintenance

Keep this README aligned with the checked-in workspace and verified deployment configuration. When adding a real user-facing feature, update the implementation status, package map, API contract, and operational instructions together.