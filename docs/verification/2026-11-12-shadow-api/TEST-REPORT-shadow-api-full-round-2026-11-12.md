# BibleApp — Shadow API Full Testing Round

Date: 2026-11-12 · Environment: Lampy, shadow DB `bible_hebrew_variant_shadow_20261107`
API: supervisor-managed `bible-app-api`, 127.0.0.1:8799 · Tester: Muse (per GPT's brief, authorized by Kit)
Method: live HTTP requests against the deployed routes + independent read-only SQL cross-checks.
No modifications of any kind were made (data, schema, permissions, config, services, source).

## A. Executive summary

**45 of 45 executed tests PASS. Zero failures.** The deployed Hebrew vowel-variant API is
functionally correct against the shadow database on every axis tested: authentication,
word→group lookup, group retrieval, membership, occurrence retrieval with cursor pagination,
verse integration, Aramaic handling, negative/boundary handling, response structure, and the
runtime invariant suite. Three warning-level observations (no functional failures) are listed
in §F. Final disposition: **PASS WITH WARNINGS** (§H).

One methodology note, per the brief's §7: **no automated test suite exists for this API in the
deployed tree** — `/opt/bible-app-api/artifacts/api-server` contains no test/spec files and its
package.json has no test script (scripts: dev/build/start/typecheck). The "available
comprehensive test suite" was therefore executed as a purpose-built verification battery
(`shadow_battery.py`, 45 checks) run against the live deployment, with results preserved in
`shadow-api-battery-results-2026-11-12.json`. Nothing was invented to fill that gap; the
battery's every check is listed in §B.

## B. Test inventory (45 executed: 45 PASS, 0 FAIL, 0 BLOCKED)

- **Auth (6):** A1 no token → 403 exact body · A2 wrong token → 403 · A3 Bearer mechanism → 403
  (token is header-only by design) · A4/A5 no token on group/occurrences → 403 · A6 valid
  `x-sandbox-token` → 200.
- **Regression (5):** R1–R5 — see §C.
- **Functional cross-checks vs DB (7):** F1 60/60 sampled grouped words exact group match ·
  F2 60/60 ungrouped words → null · F3 15 Aramaic words (of 124 grouped Aramaic words) exact
  group + `language: aramaic` · F4 ambiguous-key resolution (see §D) · F5 25/25 sampled groups:
  member key sets and every member `occurrenceCount` exactly equal to DB · F6 cursor walk of
  the largest member (group 302, **924 occurrences**, 10 pages at limit=100): exact DB set, no
  duplicates · F7 occurrence verse book/chapter/verse, word position, and pointed text all
  equal to DB for member 504/(21384,3,1).
- **Negative / boundary (20):** N1–N20 — invalid IDs (0, −1, non-numeric, leading zeros,
  >2⁶³ overflow) → 400 with the documented error strings, never 500 · nonexistent word →
  404 "Source word not found" · nonexistent group → 404 "Variant group not found" · member not
  in group → 404 · limit 0 / 101 → 400, limit=abc → 400 · garbage cursor → 400 · cursor minted
  for one member rejected on another → 400 · bare route / extra path segment / POST → 404 ·
  unknown query param ignored → 200 · trailing slash → 200 (lenient routing, recorded).
- **Structure (4):** S1 JSON content type · S2 by-word payload shape incl. all dataset fields ·
  S3 group payload carries `interpretiveLimit` and full member detail · S4 handled-route error
  bodies are JSON `{"error": …}`.
- **Invariants (3):** I1 DB counts equal the API's EXPECTED constants exactly —
  groups 3,349 / members 7,148 / unique member keys 7,145 / language-matched occurrences
  32,676 · I2 live responses carry `validation: runtime-invariants-passed` (the API re-runs
  its 11-check invariant SQL against the DB, cached 30 s) · I3 no (member key, language) pair
  is assigned to more than one group.

## C. Regression results (mandatory cases)

| Case | Result |
|---|---|
| `GET …/by-word/238432` | 200, group **504** ✓ |
| `GET …/504` | 200, members exactly {(6627,4,11), (21384,3,1)} ✓ |
| `GET …/504/members/6627/4/11/occurrences` | 200, occurrence word set {213637, 215100} == DB ✓ |
| Ezekiel 27:32 (verse 21321), word 238432 | group **504** ✓ |
| 238431 → 181 · 238435 → 2659 · 238436 → 2177 | all unchanged ✓ |
| 238430, 238433, 238434, 238437–238440 | all `group: null` ✓ |

## D. Data integrity

No discrepancies between API responses and shadow DB records were found in any sampled or
exhaustive check. Two structural properties were examined closely and are **by design, not
defects**:

1. **Cross-language member keys.** Three member keys of root 2752 — (1,34), (7,13), (7,18) —
   each exist in two groups, one Hebrew and one Aramaic (235/3324, 1040/3333, 1047/3334);
   32 words carry these keys. Resolution is by the word's own language flag, the API throws
   if a (key, language) pair ever maps to two groups, and invariant I3 confirms none does.
   F4 verified Hebrew words resolve to the Hebrew groups.
2. **Occurrence counting is language-matched.** A naive key-only join counts 32,753
   occurrences; the API's 32,676 excludes 77 words whose language flag differs from the
   member's. The API's invariant SQL uses the same language-matched rule, and I1 confirms the
   DB reproduces 32,676 exactly under that rule.

## E. Security

Sandbox authentication is intact: all three routes reject missing and wrong tokens with 403
and the exact documented body; the accepted mechanism is the `x-sandbox-token` header compared
with `timingSafeEqual` (source-verified). Production isolation is intact: the shadow login has
zero write privileges, and pg_hba rejects it for `bible` and `bible_app` (verified in the
preceding §§1–6 round, unchanged). No credential value was printed, logged, or transmitted;
the token was used only inside Lampy. No production database was connected to — the only
production-directed connection attempts were the two deliberate *rejected* fencing probes in
the earlier verification round.

## F. Issues (warnings and observations; no defects)

1. **W1 — No committed automated test suite for this API.** The deployed tree has no test
   files and no test script; verification depends on ad-hoc batteries like this one. A future
   regression could ship undetected.
2. **W2 — Unmatched routes return Express's default HTML 404**, while every handled route
   returns JSON errors. Cosmetic contract inconsistency; API clients that parse all error
   bodies as JSON will fail on unmatched paths (bare route, extra segments, wrong method).
3. **W3 — Trailing-slash leniency.** `/by-word/238432/` returns 200 rather than 404. Harmless,
   recorded so it is a known behavior rather than a surprise.

## G. Recommendations (not implemented — testing only)

1. Commit a test suite for the variant routes (the 45-check battery is preserved with this
   report and can seed it) and wire it into the api-server package scripts.
2. Add a JSON 404 handler for unmatched `/api/...` paths so the error contract is uniform.
3. Decide explicitly whether trailing-slash leniency is intended; document either way.
4. Keep the runtime invariant gate as-is — it is the strongest part of this deployment.

## H. Final disposition

**PASS WITH WARNINGS** — all 45 executed tests passed with full DB cross-verification and no
data-integrity discrepancies; the warnings in §F are process/contract observations, not
functional or data failures.
