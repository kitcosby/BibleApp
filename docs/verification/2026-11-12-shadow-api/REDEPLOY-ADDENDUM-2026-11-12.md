# Redeploy addendum — 2026-11-12

Links the deployment claim to its evidence, per the three distinct claims:

1. **The shadow API passed its 45-test battery** — see `TEST-REPORT-shadow-api-full-round-2026-11-12.md`
   and `shadow-api-battery-results-2026-11-12.json` in this directory (target: 127.0.0.1:8799,
   pre-redeploy build from checkout `ac66891`).
2. **The production deployment passed a 45-test battery after promotion** — see
   `shadow-api-battery-results-2026-11-12-production-post-redeploy.json` in this directory
   (target: 127.0.0.1:8799, post-redeploy; 45 PASS / 0 FAIL, re-run fresh after promotion).
3. **The deployment corresponds to the intended GitHub main commit** — the Lampy production
   checkout `/opt/bible-app-api` was fast-forwarded `ac66891` → **`1ec08e24daa9274a8c9c51a0d7ef12aea51b6e11`**
   (GitHub main at the time of promotion, including PR #12), rebuilt in place, and restarted
   under Supervisor (`bible-app-api`). Production dist sha256 prefix: `5fcbdc5ee0239581`
   (builds are not byte-deterministic across directories; the staging build of the same
   commit is `4c31bcd4ac8c6001`).

Rehearsal record: the same commit was first built and exercised on staging
(`bible-app-api-staging`, 127.0.0.1:8798): shadow battery 45/45 with production-parity
environment, and the repository's own suites passed via their documented runners
(`test:authorization` 13/13, `test:identity` 7/7). Staging's start wrapper now also sources
`/root/bible-hebrew-variant-api.env` (it previously had no sandbox token or variant DB URL,
so its variant routes were unreachable); a staging-only sandbox token was provisioned.

The Hebrew vowel-variant route source (`hebrew-vowel-variants.ts`) and its DB library are
blob-identical between the pre- and post-redeploy checkouts; the promoted delta is the
translation-authoring/identity work, tests, and documentation.
