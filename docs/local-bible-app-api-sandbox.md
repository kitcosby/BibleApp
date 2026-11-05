# Local BibleApp API sandbox

This branch adds a localhost-only API adapter for the existing Lampy
`bible_app` PostgreSQL database. It does not introduce or run migrations.

## Verified database setup (2026-11-04)

The maintainer reports the following completed work:

- PostgreSQL login role `bible_app_api` exists with connection limit 10.
- The role can read `translation`, `other_option`, `word_choice`, and
  `lemma_default`; mutate `word_choice`; insert `other_option`; use its ID
  sequence; and update only `translation.updated_at`.
- Negative permission checks confirmed no access to `app_user`,
  `user_accounts`, or `reading_position`.
- The live schema matches the SQL used by the API. Legacy timestamp columns
  are TEXT; this is compatible with the current queries.
- The baseline contains two translations (KJV and Young's); the related
  option, word-choice, and lemma-default tables were empty at verification.
- The API was built and passed 19 endpoint/security/data-integrity checks.
  Test data was removed and the original data was verified byte-for-byte.
- Credentials and the sandbox token are stored outside Git in the
  root-only `/root/bible-app-api.env` file (mode 0600, as reported).
- No schema migrations or existing-data changes were made.

These are maintainer-reported results. Repeat the checks after any code,
database, or runtime change; do not infer that the service is deployed from
the successful sandbox tests.

## Safety boundary

- The API binds to `127.0.0.1` only.
- All `/api/bible/*` routes require the sandbox token in the
  `x-sandbox-token` header.
- The sandbox token is not production authentication.
- Keep the API localhost/tailnet-only until real user authentication and
  per-user ownership checks are implemented and reviewed.
- Keep PostgreSQL on localhost. Never expose port 5432 or forward it to the
  public internet.
- Never commit `DATABASE_URL`, `BIBLE_APP_SANDBOX_TOKEN`, passwords, or
  other secrets.
- Do not run `drizzle-kit push`, `push-force`, or schema migrations against
  the existing database.
- Do not use the PostgreSQL superuser in the API connection string.

## Routes

All paths are under `/api`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/bible/healthz` | Check API-to-PostgreSQL connectivity |
| GET | `/bible/translations` | List translations |
| GET | `/bible/translations/:translationId` | Read a translation, its Other options, selected-word count, and lemma defaults |
| PUT | `/bible/translations/:translationId/choices/:wordId` | Set a word choice; choice 0 removes the sparse row |
| POST | `/bible/translations/:translationId/options` | Add an Other rendering |

Every route requires `x-sandbox-token`. Mutations use parameterized SQL;
word-choice changes are transactional.

## Current deployment state

The API is **not yet installed as a supervised Lampy service**.

Inspection of the live configuration found:

- Supervisor has the eight existing services but no BibleApp API entry.
- Apache proxies `/app` to the forum and `/bible` to the legacy Flask app;
  it has no `/api/` proxy.
- Linux Node.js 24.22.1 LTS is now installed in WSL at `/opt/node`.
  Node 24.22.1, npm 11.19.1, and Corepack 0.36.0 were verified.
- Git and GitHub CLI are installed. A read-only deploy key has been
  generated locally; repository authorization and checkout are pending.
- The API entrypoint listens on `127.0.0.1` and requires `PORT`.
  The environment file reports `PORT=8799`.

The Linux runtime decision is complete. The next blocker is authorizing
the Lampy read-only deploy key on the private GitHub repository so the
branch can be checked out and built on the machine.

## Deployment sequence

1. Add the generated public deploy key to `kitcosby/BibleApp` as a
   read-only Deploy Key.
2. Check out this branch into a dedicated directory such as
   `/opt/bible-app-api`; do not place it under the legacy Flask app.
3. Install the pinned workspace dependencies with the repository's pnpm
   lockfile and build the API. Use the repository's documented workspace
   build sequence; `tsc -b` is the known-good project-reference build.
4. Create a root-owned launcher that loads `/root/bible-app-api.env` and
   execs the API entrypoint. Keep the environment file mode 0600 and out of
   Git.
5. Add a separate Supervisor program for the API, bound to localhost port
   8799. Do not edit or duplicate the existing Supervisor daemon.
6. Add an Apache `ProxyPass` and `ProxyPassReverse` for `/api/` to
   `http://127.0.0.1:8799/api/`. Preserve the existing `/bible` and
   `/app` mappings.
7. Validate Apache configuration before reload. Reload only after the new
   config passes validation; do not restart the whole Lampy stack.
8. Test the API through localhost and the intended tailnet HTTPS ingress.
   Confirm the token gate, database connectivity, and read/write routes.
9. Keep the API private until production authentication and per-user
   authorization are implemented.

## Deferred hardening

The maintainer deliberately deferred server-wide PostgreSQL changes:
local connection authentication policy and per-role CONNECT restrictions
across other databases. Assess effects on the forum and both pgai workers
before changing either. Do not include these changes in the API deployment.

## Workspace build note

The API package build entrypoint is `artifacts/api-server/build.mjs`, and
the package start command is `node --enable-source-maps
artifacts/api-server/dist/index.mjs` when run from the package directory.
The root workspace uses pnpm and project references. A plain package-level
typecheck is not a substitute for the known-good `tsc -b` workspace build.
