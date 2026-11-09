# BibleApp Core API Contract Inventory

**Status:** Baseline inventory (2026-11-08) with staged security delta (2026-11-09).  
**Baseline:** `main` at `742446785a39bec3178d2954589ebcb86a6a59a7`.  
**Scope:** The opening findings describe that baseline. The Express route inventory and identity-token section describe the staged changes on BibleApp PR #9, not deployed behavior. Lampy Flask corpus routes are identified separately as the existing service. This document is not approval to expose the API publicly or migrate production data.

## Executive finding

The repository does not yet contain one complete, portable BibleApp core API.

- The Express service in `artifacts/api-server` exposes health, translation-authoring, and Hebrew vowel-variant routes.
- Corpus, morphology, verse, word, and search reads are still provided by the separate Lampy Flask application at `/bible`.
- The separate `BibleApp-pwa` repository consumes the public read-only Flask corpus API; the frontend package inside this Express monorepo remains a scaffold.
- At the baseline `main` commit, Express uses a shared sandbox token and does not enforce per-user translation ownership; its CORS policy is unrestricted.
- Draft BibleApp PR #9 stages a Flask-issued bearer identity, exact-origin CORS, and owner enforcement. Those changes are not on `main` and have not been deployed.

A portability effort must therefore define and implement a complete core contract rather than merely relocate the existing Express process.

## 1. Express API (staged security branch)

Base mount: `/api`  
Server entry: `artifacts/api-server/src/index.ts`  
Application middleware: `artifacts/api-server/src/app.ts`  
Router: `artifacts/api-server/src/routes/index.ts`

### Middleware and authentication observations

| Concern | Current behavior | Assessment |
|---|---|---|
| Request logging | Pino HTTP; query strings removed from logged URL | Positive baseline; review body/header logging before adding auth |
| CORS | Explicit `BIBLEAPP_ALLOWED_ORIGINS` allowlist; bearer API does not enable credentialed CORS | Configure exact HTTPS origins; no wildcard |
| Body parsing | JSON and URL-encoded | Existing |
| Health | `GET /api/healthz` is public liveness; `/api/bible/healthz` is behind user identity | Does not disclose credentials or database names |
| Authoring authorization | `/bible` requires a short-lived HS256 identity token issued by the authenticated Flask session | Per-user identity, not the shared sandbox token |
| Variant authorization | Variant router retains its separate timing-safe `BIBLE_APP_SANDBOX_TOKEN` check | Internal-only until a deliberate public-read policy is approved |
| Browser credentials | Browser obtains a five-minute bearer token from Flask using its existing session cookie and CSRF token | No shared service secret in browser; bearer token kept in memory |
| Ownership | Translation list/detail are filtered to the authenticated owner plus the two verified built-in read-only translations; writes lock and verify the owner row | Cross-user access denied |
| Database | `DATABASE_URL` pool for authoring; dedicated `HEBREW_VARIANT_DATABASE_URL` pool for read-only variant shadow data | Keep isolated; never expose URLs to browser |

The router-level middleware in `routes/index.ts` means that **all** `/api/bible/*` routes require a valid Flask-issued bearer identity token, including translation list/detail and the nested database health route. The separate Hebrew-variant endpoints still require the server-side sandbox token. Neither route family should receive a service-wide secret in browser code.

### Current route inventory

| Method and path | Data / behavior | Auth currently applied | Portability / contract notes |
|---|---|---|---|
| `GET /api/healthz` | Process health | Public liveness only | No database details or credentials |
| `GET /api/bible/healthz` | Checks legacy authoring DB pool with `SELECT 1` | Flask-issued bearer identity | Authenticated DB health check; prefer the public process liveness route for probes |
| `GET /api/bible/translations` | Lists built-in and caller-owned translation metadata | Flask-issued bearer identity | Filters by verified account ID; built-ins are matched by ID and name |
| `POST /api/bible/translations` | Creates a private translation | Flask-issued bearer identity | Server assigns `owner_id` from verified identity; satisfies the legacy `translation.user_id` FK using the legacy `app_user` row |
| `GET /api/bible/translations/:translationId/choices?wordIds=...` | Returns explicit stored choice bytes for 1–100 requested Hebrew word IDs | Flask-issued bearer identity plus owner/built-in check | Queries only requested IDs; lemma defaults and Other options remain in translation detail |
| `GET /api/bible/translations/:translationId` | Translation metadata, other options, selected word count, lemma defaults | Flask-issued bearer identity | Authorizes the parent translation before reading child rows |
| `PUT /api/bible/translations/:translationId/choices/:wordId` | Upserts or deletes a word choice; optionally upserts its forward-only lemma default in the same transaction | Flask-issued bearer identity plus owner row lock | Denies built-ins and non-owner writes; validates word ID, lemma key, source, from-word ID, and Other-option ownership |
| `POST /api/bible/translations/:translationId/options` | Adds an alternate rendering option or returns an existing duplicate | Flask-issued bearer identity plus owner row lock | Denies built-ins and non-owner writes; deduplicates exact text, caps at 230 options, and serializes index allocation |

### Hebrew vowel-variant endpoints

All three endpoints below are mounted at `/api/lexicon/hebrew-vowel-variants` and require the sandbox token using a timing-safe comparison. The handler validates the shadow dataset's expected algorithm, snapshot ID, counts, and relational invariants before serving data. The DB pool is dedicated and read-only.

| Method and path | Behavior | Contract details |
|---|---|---|
| `GET /api/lexicon/hebrew-vowel-variants/by-word/:wordId` | Finds a candidate vowel-only orthographic group for a source word | Returns `{ group: null }` when the word has no group; distinguishes unknown source word (404) |
| `GET /api/lexicon/hebrew-vowel-variants/:variantGroupId` | Returns group/member metadata | Carries explicit interpretive limit: orthographic relation only; lexical identity, morphology equivalence, and meaning are not adjudicated |
| `GET /api/lexicon/hebrew-vowel-variants/:variantGroupId/members/:rootId/:rootFormSeq/:vowelSeq/occurrences` | Paginates occurrences for a group member | Default limit 50; allowed 1–100; opaque base64url cursor tied to group/member identifiers |

The exact JSON response shapes are defined by the current TypeScript handlers. Before making this a stable public contract, extract those shapes into shared schemas and contract tests rather than hand-maintaining duplicate definitions.

## Identity-token contract (staged implementation)

The existing Flask `user_accounts` table and Flask session remain the sole account authority. Once a user is authenticated in Flask, the browser can obtain a short-lived API token:

1. The browser calls `GET /bible/api/auth/csrf` using `credentials: "include"`. Flask returns the session-bound CSRF token and requires an active account.
2. The browser sends `POST /bible/api/auth/token` with `credentials: "include"` and `X-CSRF-Token`. Flask verifies the session, active account, CSRF token, and allowed Origin.
3. Flask signs an HS256 JWT with issuer `bibleapp-flask`, audience `bibleapp-api`, numeric account ID in `sub`, `iat`, `exp` (five minutes), and random `jti`.
4. The browser keeps the returned bearer token in memory and sends `Authorization: Bearer ...` to the Express `/api/bible/*` routes. It must not persist the token in localStorage, sessionStorage, URLs, or logs.
5. Express verifies signature with constant-time comparison, issuer, audience, subject, issuance/expiry bounds, and maximum five-minute lifetime. It uses only the verified `sub` as the owner identity.

**Client-integration status:** the PWA account-authentication PR stages the Account view, pre-auth CSRF bootstrap, JSON login/signup/logout, and in-memory Flask-to-Express token exchange. That PR is not yet merged. The PWA still does not create/select translations or call Express authoring routes; existing rendering choices remain localStorage-only. Do not imply that account-backed authoring or synchronization is complete.

Express marks every `/api/bible/*` response `Cache-Control: private, no-store`. The PWA service-worker hardening in [BibleApp-pwa PR #2](https://github.com/kitcosby/BibleApp-pwa/pull/2) bypasses the shared API cache for session/auth routes, bearer-authenticated requests, and the private Bible API; it also refuses to cache `no-store` responses and removes the old cache versions. This is required to prevent cross-account response reuse on a shared device.

Required environment configuration (values are secrets and must never be committed or sent to the browser):

- `BIBLEAPP_IDENTITY_TOKEN_SECRET`: the same independently generated random value of at least 32 UTF-8 bytes in Flask and Express. This is separate from the Flask session secret and sandbox token.
- `BIBLEAPP_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins allowed by Flask's token endpoint and Express API. No wildcard or URL paths.
- For cross-site browser login, Flask must use `BIBLEAPP_COOKIE_SAMESITE=None` and `BIBLEAPP_COOKIE_SECURE=1`; this is rejected at startup if Secure is not enabled. Same-origin deployments can retain the default Lax cookie.

The token is not immediately revocable after logout or account deactivation; the residual exposure window is at most five minutes. Do not call this server-side session revocation. A later revocation/introspection design may be needed for higher-risk operations.

The API identity token does not replace the separate Hebrew-variant sandbox token yet. That route family remains internal-only. The current Express authoring PR adds translation creation, explicit-choice retrieval, and transactional lemma-default writes. It still does not itself reconstruct the Flask dropdown list: the client must preserve the exact KJV-then-Young's-then-Other ordering, with the current occurrence's phrase first in each phrase group. The current numeric choice API is therefore not behaviorally equivalent until the PWA's option-building and selection logic is implemented and tested against Flask. Greek word-choice persistence is also not supported by the existing 264,217-row Hebrew `word_choice` key space.

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


## 8. Existing BibleApp PWA client contract (separate repository)

The current reader client is in `kitcosby/BibleApp-pwa`, not in the Vercel monorepo's placeholder frontend. Its `main` branch `index.html` is a single-file static PWA with no build step or server code.

### API base selection — updated 2026-11-08

PR #1 in `kitcosby/BibleApp-pwa` was merged as commit `997bfe3cd076ecdd86e99983c7170ac28ea4a89b`. The PWA now loads `config.js` before its inline application code and reads `window.BIBLEAPP_API_BASE`.

- Current default: `/bible`, preserving the existing same-origin Lampy deployment.
- Portable deployment: set the value in `config.js` to the chosen core API HTTPS origin/path, without a trailing slash.
- The client now calls exactly one configured API base. The hard-coded Lampy Funnel/tailnet URLs and session-sticky probe/fallback list have been removed from application code.
- If that configured API is unavailable, the existing labeled sample/offline behavior remains; the app does not silently fall back to Lampy.
- Service worker shell cache is `byot-v17`; `config.js` is included and fetched network-first with cached fallback for offline use.
- `config.js` must contain no credentials or secrets. Cross-origin hosting requires a deliberate API CORS policy.

This is a portability prerequisite, not a completed backend migration. The default configuration still targets the current Lampy `/bible` path, and no production deployment or cutover was performed.

### Client-requested endpoints

The PWA uses these GET routes:

- `/api/books`
- `/api/chapters/:book`
- `/api/verses/:book/:chapter`
- `/api/verse/:book/:chapter/:verse`
- `/api/chapter/:book/:chapter`
- `/api/word/:strongs`
- `/api/search?q=:query`

When mounted under the current default `/bible` prefix, these resolve to the public `/bible/api/...` routes. This matches the Lampy Flask route inventory above.

### Browser-side state and offline behavior

The PWA stores rendering choices and witness/tradition preferences in browser storage (including localStorage), and uses service-worker caches for the shell and successful API responses. This is distinct from the legacy Flask translation-authoring database and the Express API's `bible_app` database.

Therefore:
- Do not claim PWA rendering choices are currently persisted to the server.
- Do not assume these local preferences are already represented by the Express translation-authoring routes.
- A future account-backed sync feature needs a deliberate import/export and conflict-resolution design; it must not silently overwrite either localStorage choices or existing `word_choice` records.
- Offline cache behavior must remain explicit and must not disguise stale data as freshly synchronized server state.

### Product boundary decision

Use the existing `BibleApp-pwa` as the **initial portable frontend** because it already provides the functioning Study/Read/Word/Search experience. Keep `BibleApp` monorepo's Vite frontend as an experimental/scaffold track until it reaches functional parity; do not spend effort rebuilding the same reader UI there first.

The Vite app's current `App.tsx` remains a placeholder. This decision does not prevent a future replacement, but any replacement must demonstrate parity and migration of browser-local preferences before the PWA is retired.


Identity and translation-ownership findings and the recommended authorization model are documented in [Identity and Authorization](identity-and-authorization.md). This is a design recommendation, not an implemented or approved public-account policy.
