# Local BibleApp API sandbox

This branch adds a localhost-only API adapter for the existing Lampy
`bible_app` PostgreSQL database. It does not introduce or run migrations.

## Safety boundary

- The API binds to `127.0.0.1` only.
- All `/api/bible/*` routes require the `x-sandbox-token` header.
- Set `BIBLE_APP_SANDBOX_TOKEN` and `DATABASE_URL` in a protected local
  environment file. Never commit either value.
- Do not expose PostgreSQL port 5432 or forward it to the public internet.
- Do not run `drizzle-kit push`, `push-force`, or schema migrations against
  the existing database.
- The restricted PostgreSQL role has **not yet been provisioned**. Until it
  exists, do not point this API at the database using the postgres superuser.

## Routes

All paths are under `/api`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/bible/healthz` | Check API-to-PostgreSQL connectivity |
| GET | `/bible/translations` | List translations |
| GET | `/bible/translations/:translationId` | Read a translation, its Other options, selected-word count, and lemma defaults |
| PUT | `/bible/translations/:translationId/choices/:wordId` | Set a word choice; choice 0 removes the sparse row |
| POST | `/bible/translations/:translationId/options` | Add an Other rendering |

Every route requires `x-sandbox-token`. Mutations use parameterized SQL
and a transaction where multiple statements are involved. Client errors do
not expose database exception details.

## Current limitations

- This is a local sandbox adapter, not a production authentication system.
- The API does not yet implement user signup/login, ownership authorization,
  reading-position endpoints, or the full legacy translation workflow.
- The existing database schema must be introspected against the live server
  before granting the API role. This branch intentionally avoids Drizzle
  schema push and does not assert that the legacy schema has been migrated.
- Build, typecheck, and live read/write tests remain pending until the local
  restricted role and environment are provisioned.
