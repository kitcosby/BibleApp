# Shadow database access verification — 2026-11-12

Scope: Kit's "BibleApp — Shadow Database Access Instructions" (next testing round), sections 1–6.
Method: read-only checks on Lampy only. The database session was opened read-only; no writes,
no schema changes, no restarts, no production connections (two *rejected* connection attempts
were made deliberately to prove fencing). No credential value was printed or transmitted at any
point; the sandbox token was used only inside Lampy, held in a shell/process variable.

## Results (all verified live, 2026-11-12 ~04:59–05:04 PST)

| Check | Result |
|---|---|
| Lampy reachable | PASS — via the distro's own tailnet node (`lampy-ssh.sh`) |
| Env file `/root/bible-hebrew-variant-api.env` | PASS — owner root:root, permissions 0600, 160 bytes, exactly one key (`HEBREW_VARIANT_DATABASE_URL`) |
| PostgreSQL accepting localhost TCP | PASS — listening on 127.0.0.1:5432; SCRAM login succeeded |
| Database / role | PASS — `current_database()` = `bible_hebrew_variant_shadow_20261107`, `current_user` = `bible_variant_api`, server 127.0.0.1:5432, PostgreSQL 16.10 |
| Role attributes | PASS — NOSUPERUSER, NOCREATEDB, NOCREATEROLE, LOGIN, connection limit 5 |
| Read-only isolation | PASS — 10 public tables (the documented grant set); **zero** tables with INSERT/UPDATE/DELETE/TRUNCATE privilege; no schema CREATE, no database CREATE |
| Corpus spot state | words 264,217; `hebrew_vowel_variant_group` 3,349; `hebrew_vowel_variant_member` 7,148 — both counts exactly match the API build's compiled-in EXPECTED invariants, and the API reports `validation: runtime-invariants-passed` |
| Production fencing | PASS — the shadow credentials are **rejected by pg_hba** for both `bible` and `bible_app` |
| API process | RUNNING — supervisor program `bible-app-api` (pid 42, uptime ~1d 6h), node `dist/index.mjs` from `/opt/bible-app-api/artifacts/api-server`, listening on 127.0.0.1:8799. The staging sibling runs on 8798 and answers identically. |
| Sandbox authentication | PASS — no token → 403 `{"error":"Sandbox authorization required"}`; Bearer form rejected; correct form is header `x-sandbox-token`, compared with `timingSafeEqual` (source: `artifacts/api-server/src/routes/hebrew-vowel-variants.ts`) |
| Temporary process (port 5187) | NOT RUNNING — no listener, as the instructions anticipated |

## Previously successful test cases — re-run against the live API (8799)

The real routes carry path parameters (the bare route is not a route; it 404s *after* auth):

- `GET /api/lexicon/hebrew-vowel-variants/by-word/238432` → **200**, group **504** ✓
- `GET /api/lexicon/hebrew-vowel-variants/504` → **200**, group with members ✓
- `GET /api/lexicon/hebrew-vowel-variants/504/members/6627/4/11/occurrences` → **200**, occurrences returned ✓
- **Ezekiel 27:32 exact data** → verse_id 21321, 11 words scanned: 238431 → group 181, **238432 → group 504** (Kit's test word is an Ezekiel 27:32 word), 238435 → group 2659, 238436 → group 2177, remaining words correctly `group: null` ✓

## Distinction against the instructions' §7

The instructions held API deployment as "requires verification." Verified state is stronger
than the temporary-process baseline: the variant routes are live in the supervisor-run
`bible-app-api` process on 8799 (not only in the retired 5187 temporary process), backed by the
dedicated shadow pool, with sandbox auth enforced. Database access and read-only isolation are
exactly as previously established — unchanged since the 2026-11-08 end state (same group/member
counts, same env file size).

## Not done / notes

- No part of the larger test suite was run — this report covers §§1–6 only, per the recommendation.
- `/health` on 8799 returned 404; liveness is proven by the variant routes themselves. The
  health route's exact path was not chased down.
- Nothing was modified: no restarts, no config edits, no DB writes (the verification session
  itself was opened with `readonly=True`).
