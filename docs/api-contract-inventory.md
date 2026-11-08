# BibleApp Core API Contract Inventory

**Status:** Initial source-backed inventory, 2026-11-08  
**Branch:** `api-contract-inventory-20261108`  
**Scope:** Current GitHub implementation on `main`; Lampy Flask corpus routes are identified separately as an existing external service. This document is an inventory, not an approval to expose the current API publicly or migrate production data.

## Executive finding

The monorepo does not currently contain one complete BibleApp core API.

- The Express service in `artifacts/api-server` exposes health, translation-authoring, and Hebrew vowel-variant routes.
- Corpus, morphology, verse, word, and search reads are still provided by the separate Lampy Flask application at `/bible`.
- The current frontend package is still a placeholder and does not consume either API.
- The Express service's current sandbox-token mechanism is not end-user authentication. Translation ownership is not enforced by the inspected handlers.
- The Express app currently enables unrestricted default CORS with `app.use(cors())`. That is not a production access policy.

A portability effort must therefore define and implement a complete core contract rather than merely relocate the existing Express process.

## 1. Current Express API

Base mount: `/api`  
Server entry: `artifacts/api-server/src/index.ts`  
Application middleware: `artifacts/api-server/src/app.ts`  
Router: `artifacts/api-server/src/routes/index.ts`

### Middleware and authentication observations

| Concern | Current behavior | Assessment |
|---|---|---|
| Request logging | Pino HTTP; query strings removed from logged URL | Positive baseline; review body/header logging before adding auth |
| CORS | Express `cors()` defaults | Broad origin access; replace with explicit allowlist and credential policy |
| Body parsing | JSON and URL-encoded | Existing |
| Health | Health router mounted before protected route groups | Health route is separate from authoring and variant routes |
| Authoring authorization | Router middleware on `/bible` requires `BIBLE_APP_SANDBOX_TOKEN` for every route below that prefix | Shared secret, not user identity |
| Variant authorization | Variant router has its own timing-safe comparison of `BIBLE_APP_SANDBOX_TOKEN` | Shared secret, not user identity |
| Browser credentials | No user session or bearer identity contract in inspected route code | Not suitable for public multi-user authoring |
| Ownership | Translation handlers verify existence, but do not check caller ownership | Critical authorization gap |
| Database | `DATABASE_URL` pool for authoring; dedicated `HEBREW_VARIANT_DATABASE_URL` pool for read-only variant shadow data | Keep isolated; never expose URLs to browser |

The route-level middleware in `routes/index.ts` means that **all** `/api/bible/*` routes, including translation list/detail and the nested health route, require the sandbox token. Do not document the GET endpoints as public.

### Current route inventory

| Method and path | Data / behavior | Auth currently applied | Portability / contract notes |
|---|---|---|---|
| `GET /api/healthz` | Process health | No sandbox middleware | Health router is mounted before protected route groups |
| `GET /api/bible/healthz` | Checks legacy authoring DB pool with `SELECT 1` | Sandbox token via `/bible` prefix middleware | Prefer one documented health route; avoid exposing DB details |
| `GET /api/bible/translations` | Lists translation metadata, including `user_id` and `owner_id` | Sandbox token | Returns all rows; no per-user filtering or authorization in handler |
| `GET /api/bible/translations/:translationId` | Translation metadata, other options, selected word count, lemma defaults | Sandbox token | Existence check only; no caller/owner authorization |
| `PUT /api/bible/translations/:translationId/choices/:wordId` | Upserts or deletes a word choice; updates translation timestamp | Sandbox token plus route-local duplicate check | Does not verify translation ownership or that word ID is valid in canonical corpus |
| `POST /api/bible/translations/:translationId/options` | Inserts an alternate rendering option | Sandbox token | Does not verify caller ownership; concurrency and ordering semantics need review |

### Hebrew vowel-variant endpoints

All three endpoints below are mounted at `/api/lexicon/hebrew-vowel-variants` and require the sandbox token using a timing-safe comparison. The handler validates the shadow dataset's expected algorithm, snapshot ID, counts, and relational invariants before serving data. The DB pool is dedicated and read-only.

| Method and path | Behavior | Contract details |
|---|---|---|
| `GET /api/lexicon/hebrew-vowel-variants/by-word/:wordId` | Finds a candidate vowel-only orthographic group for a source word | Returns `{ group: null }` when the word has no group; distinguishes unknown source word (404) |
| `GET /api/lexicon/hebrew-vowel-variants/:variantGroupId` | Returns group/member metadata | Carries explicit interpretive limit: orthographic relation only; lexical identity, morphology equivalence, and meaning are not adjudicated |
| `GET /api/lexicon/hebrew-vowel-variants/:variantGroupId/members/:rootId/:rootFormSeq/:vowelSeq/occurrences` | Paginates occurrences for a group member | Default limit 50; allowed 1–100; opaque base64url cursor tied to group/member identifiers |

The exact JSON response shapes are defined by the current TypeScript handlers. Before making this a stable public contract, extract those shapes into shared schemas and contract tests rather than hand-maintaining duplicate definitions.

## 2. Existing Lampy Flask corpus API

This is a separate deployed application, not the Express API in this repository. Its public prefix is `/bible`, upstream `127.0.0.1:5057`, application source previously inspected at `/opt/bible/website/app_v2.py`.

The following read endpoints are currently consumed by the existing BibleApp PWA:

| Method and path | Purpose | Target classification |
|---|---|---|
| `GET /bible/api/books` | Book list | Core |
| `GET /bible/api/chapters/:book` | Chapter list for a book | Core |
| `GET /bible/api/verses/:book/:chapter` | Verse list for a chapter | Core |
| `GET /bible/api/verse/:book/:chapter/:verse` | Verse payload | Core |
| `GET /bible/api/chapter/:book/:chapter` | Chapter payload | Core |
| `GET /bible/api/word/:strongs` | Word/Strong's lookup | Core |
| `GET /bible/api/search` | Existing search | Core; redesign intentionally deferred |

The current Flask API returns public read-only corpus data and was observed setting `Access-Control-Allow-Origin: *`. Its search path currently calls local Ollama `nomic-embed-text` to embed the query and searches the existing YLT verse embedding store. This is a temporary legacy dependency pending the separate word-variant embedding rebuild and an explicit search redesign.

The Flask application also contains legacy HTML/login/translation-authoring/reading-position behavior. That surface overlaps the Express translation-authoring data. The overlap must be mapped before any route is retired. Do not assume the Express route list above is a complete replacement for Flask behavior.

## 3. Canonical target API domains

These are proposed domains for the future contract, not routes that currently exist.

| Domain | Required capabilities | Data ownership |
|---|---|---|
| Corpus | Books, chapters, verses, chapter payloads, word payloads | Portable corpus store |
| Linguistics | Hebrew/Aramaic and Greek morphology, lemma/Strong's lookup, gloss and alignment payloads | Portable linguistic data store |
| Witnesses and variants | Hebrew/Greek textual witnesses, variant readings, provenance, uncertainty | Portable witness/variant data store |
| Translation authoring | Translation metadata, options, per-word choices, lemma defaults, reading/rendering preferences | Portable application DB |
| Search | Exact, lexical, and semantic search as deliberately specified after embedding validation | Portable index plus explicit query-embedding runtime |
| Forum | Link-first access to existing Lampy forum | Lampy only; server-side adapter only if/when a supported API exists |

For each operation, the eventual contract must state: HTTP method/path, request schema, response schema, error codes, pagination, data source, identity requirement, authorization rule, rate/size limits, and whether the route is stable/public or internal.

## 4. Security and correctness blockers before public authoring

1. Replace the shared sandbox token with a real authenticated user identity. The browser must never receive a database URL or service-wide secret.
2. Enforce translation ownership in every read and write query. A valid translation ID must not authorize access to another user's translation.
3. Define roles and sharing explicitly before adding collaborative access. Do not infer access from `user_id`, `owner_id`, or forum membership without a documented rule.
4. Validate that submitted word IDs belong to the canonical corpus and that choices/options conform to the intended schema.
5. Replace wildcard CORS with explicit allowed origins. If cookie sessions are used, define secure cookie attributes, CSRF protection, origin checks, and session lifecycle. If bearer tokens are used, define issuer, audience, expiry, refresh, and revocation.
6. Add request schemas, response schemas, and tests for malformed IDs, missing records, unauthorized owners, cross-user access, transaction rollback, duplicate submissions, and concurrent option creation.
7. Separate health/liveness from authenticated application routes without revealing secrets, database names, or internal topology.
8. Review error handling and logs so secrets, authorization headers, and personal data cannot leak.

## 5. Recommended next implementation steps

1. Finish the route-to-data inventory for the legacy Flask app and PWA, including translation creation, editing, reading position, exports, and all non-GET behavior.
2. Define the canonical API schemas and generate the typed frontend client from that source of truth.
3. Decide the end-user identity provider and account migration/linking model. Forum identity remains separate.
4. Implement authorization tests before changing the existing authoring handlers.
5. Build a portable staging backend that can be populated from verified backups/snapshots without changing Lampy's live databases.
6. Migrate one read-only domain at a time and prove it works with Lampy blocked.
7. Consolidate translation writes only after behavior parity and data-integrity checks pass.

## 6. Non-goals for this phase

- No production database writes, schema changes, or migrations.
- No service restarts or deployment changes.
- No production cutover or retirement of the legacy Flask application.
- No public exposure of the sandbox-token API.
- No redesign or switch of search before the new embedding dataset is validated.
- No forum embedding, fake verse-thread behavior, or shared identity assumption.

## Evidence and limitations

The Express route inventory is derived from current repository source: `artifacts/api-server/src/app.ts`, `src/routes/index.ts`, `src/routes/bible.ts`, `src/routes/hebrew-vowel-variants.ts`, `src/lib/hebrew-variant-db.ts`, and `lib/db/src/index.ts`. The Flask route inventory reflects the previously inspected live Lampy `app_v2.py` and the existing PWA's calls; the Flask source is not in this repository and should be re-inspected from the authoritative Lampy checkout before implementation. This document does not claim live service checks were run during this inventory.


## 7. Expanded legacy Flask route inventory (read-only Lampy inspection)

The authoritative Flask source was re-inspected on the connected laptop via `wsl -d lampy -u root`. The following route decorators were found in `/opt/bible/website/app_v2.py`:

| Route | Methods | Classification | Notes |
|---|---|---|---|
| `/` | GET | Legacy UI | Main Bible/interlinear surface |
| `/signup` | GET, POST | Identity | Local BibleApp account creation |
| `/login` | GET, POST | Identity | Local BibleApp login |
| `/logout` | GET | Identity | Local session logout |
| `/books` | GET | Core UI | Book navigation |
| `/book/<n>` | GET | Core UI | Book view |
| `/chapter/<n>/<c>` | GET | Core UI | Chapter/interlinear view |
| `/verse/<n>/<c>/<v>` | GET | Core UI | Verse/interlinear view |
| `/choice` | POST | Authoring write | Saves a word choice; may create Other option and lemma default |
| `/translations` | GET, POST | Authoring read/write | Lists and creates translations |
| `/reading/<tid>/<n>/<c>/<v>` | GET | Read UI | Clean reading view |
| `/read` | GET | Read UI | Reading navigation |
| `/read/<n>/<c>` | GET | Read UI | Chapter reading |
| `/export/<tid>` | GET | Authoring export | Exports a translation |
| `/word/<wid>` | GET | Linguistics UI | Word/lexicon detail |
| `/variants` | GET | Witness/variant UI | Variant browsing |
| `/interlinear` | GET | Core UI | Interlinear landing |
| `/interlinear/<n>/<c>/<v>` | GET | Core UI | Interlinear verse view |
| `/api/books` | GET | Core API | Book list |
| `/api/chapters/<n>` | GET | Core API | Chapter list |
| `/api/verses/<n>/<c>` | GET | Core API | Verse list |
| `/api/verse/<n>/<c>/<v>` | GET | Core API | Verse payload |
| `/api/chapter/<n>/<c>` | GET | Core API | Chapter payload |
| `/api/word/<strongs>` | GET | Core API | Hebrew/Greek Strong's lookup |
| `/api/search` | GET | Core API | Current semantic verse search |
| `/papyrus-tile.png` | GET | Static asset | UI asset, not a core data API |

### Legacy authoring and identity observations

Further read-only inspection of the Flask handlers established:

- `current_user()` reads `session['user_id']` and selects an active row from `user_accounts`.
- `current_translation()` reads the `t` query parameter and selects by `translation_id`; it does **not** check that the current user owns or is authorized to edit that translation.
- `/translations` GET queries all translations and renders them, including owner display names when available.
- `/translations` POST creates a translation. It associates the row with an `app_user` record selected/created by legacy logic and stores the current authenticated `user_accounts.user_id` as `owner_id` when a user is signed in. The fallback legacy `app_user` logic is not a suitable modern identity model.
- `/choice` POST uses the currently selected translation, word ID, and submitted item. It can insert an Other option, persists the word choice, records a forward-only lemma default, and updates the translation timestamp. The inspected handler does not enforce that the signed-in user owns the selected translation.
- The API GET routes are read-only and do not require a BibleApp session in the inspected handlers. The API CORS helper was previously observed setting `Access-Control-Allow-Origin: *`.
- `/api/search?q=...` requires `q`; `limit` defaults to 10 and is clamped to 1–25 (invalid numeric input falls back to 10). It calls local Ollama `nomic-embed-text` at `127.0.0.1:11434` and returns ranked YLT verse snippets with similarity scores. Failure to reach the embedding service returns 503.

These observations make the ownership gap concrete in both legacy and Express authoring paths. Do not expose either write surface publicly until one canonical authorization model is implemented and covered by cross-user tests.

### Important compatibility implications

The Express API's current operations are not yet behaviorally equivalent to the legacy Flask authoring flow:

- Legacy `/choice` resolves dropdown item indices against KJV, Young's, and user-defined options; it may create an Other option and updates a lemma default for subsequent occurrences.
- Express `PUT .../choices/:wordId` accepts a numeric choice byte and stores it directly; the handler does not reproduce the legacy dropdown resolution or lemma-default behavior.
- Legacy translation creation stores owner identity using the Flask account/session context; the Express API currently has no translation-create route in the inspected router.
- Legacy export, reading-position behavior, and rendered read/study routes are not represented in the current Express route set.

Therefore the planned canonical write API must be specified from actual legacy behavior and existing data semantics, not by assuming the current Express endpoints are complete replacements.
