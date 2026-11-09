# Identity and authorization decision record

**Status:** Design recommendation; implementation not yet authorized by a specific account-visibility policy  
**Date:** 2026-11-08  
**Scope:** BibleApp core accounts, translation ownership, and authorization across the legacy Flask app and Express API  
**Safety:** Documentation/design only. No database or service changes.

## Executive recommendation

Use the existing `bible_app.user_accounts` records as the initial identity source, subject to a security-hardening pass and explicit migration review. Do not create a second independent BibleApp account table in the Express API, and do not equate BibleApp accounts with Lampy forum accounts.

Make one server-side identity authority responsible for password verification, session/token issuance, account status, and authorization. The Express API must receive a verifiable per-user identity—not the shared sandbox token—and must authorize every translation operation against that identity. Browser clients must never receive service credentials or database URLs.

The least disruptive target is to preserve existing Werkzeug password hashes and account IDs, while introducing a documented authentication boundary. The exact token/session mechanism should be chosen only after deciding the hosting topology and cross-origin cookie requirements. Do not implement a second password verifier or copy password hashes into another identity store as a shortcut.

## Implementation direction confirmed by Kit

Kit has confirmed that the existing login functionality should be expanded rather than replaced. This makes the legacy Flask account system the starting point and rules out creating a second BibleApp registration/login system as part of portability work.

- Preserve the existing `user_accounts.user_id` values, usernames, and Werkzeug password hashes. Do not force account recreation or a password reset solely for the hosting move.
- Continue to verify existing passwords with Werkzeug's `check_password_hash`. If a hash needs upgrading, rehash only after a successful login and only with a reviewed migration path.
- Extend the current Flask signup/login/logout flow with security controls. Apply stronger requirements to new or changed passwords without abruptly rejecting existing passwords at login.
- Harden sessions: clear/regenerate session state at authentication boundaries, configure Secure/HttpOnly/SameSite cookie attributes for the actual deployment topology, use a stable externally supplied signing secret, and define expiry and revocation behavior. Flask's default signed-cookie session is client-held; clearing it at logout does not by itself revoke a stolen copy, so revocation must be addressed explicitly.
- Add CSRF protection to cookie-authenticated state changes, make logout POST-only, and add login throttling with a deployment-appropriate shared/persistent limiter rather than process-local counters on a multi-worker host.
- Keep Flask as the credential-verification authority. The portable core API must consume a short-lived, verifiable user identity issued by that authority (or be placed behind the same authenticated Flask boundary). Do not duplicate password verification in Express, share the Flask session-signing secret with Express, or expose the sandbox token to browsers.
- Prefer a same-origin reverse-proxy arrangement for the PWA and core API where practical. If the eventual host topology requires cross-origin API calls, document and test the exact credential, CORS, cookie, and CSRF contract before enabling them.
- Preserve the Lampy forum's independent login. No automatic account linking by matching usernames.

This is an implementation direction, not a claim that these controls are already present. The code changes should be staged and tested before any production environment or account rows are changed.

## Evidence from current source and live Lampy inspection

### Legacy Flask identity

Inspected `/opt/bible/website/app_v2.py` on Lampy:

- Password hashes are created with `werkzeug.security.generate_password_hash` and verified with `check_password_hash`.
- The account table is `user_accounts`; it includes `user_id`, unique `username`, `password_hash`, optional `email` and `display_name`, `is_active`, timestamps.
- `current_user()` resolves `session['user_id']` to an active account.
- Signup currently accepts passwords as short as four characters.
- The Flask session uses a locally generated `secret.key` fallback in the live copy inspected. A repository change now supports `BIBLEAPP_SESSION_SECRET`, but that change has not been applied to the live service.
- `/logout` is a GET route.
- No CSRF token or CSRF validation was present in the inspected login/signup/authoring forms.
- No account-level login rate limit or lockout was found in the inspected handlers.

### Legacy Flask translation authorization

- `translation.owner_id` references `user_accounts.user_id` and is nullable.
- `current_translation()` selects a translation by ID without checking the current user.
- `/translations` lists every translation, not just the current user's translations.
- `/translations` POST can create a translation without an authenticated user; the owner is then NULL. It also uses legacy `app_user` fallback logic.
- `/choice` POST writes word choices, Other options, and lemma defaults without checking that the caller is authenticated or owns the selected translation.
- Reading and export handlers also retrieve translations by ID without an owner check. Whether these should remain public-read is a product policy decision; write authorization is not optional.

### Express API

Inspected current `main` source in `kitcosby/BibleApp`:

- `artifacts/api-server/src/app.ts` enables default `cors()`, which is not a production origin policy.
- `artifacts/api-server/src/routes/bible.ts` gates authoring routes with `BIBLE_APP_SANDBOX_TOKEN`. It does not establish an end-user identity.
- Translation list/detail routes return all translation metadata, including owner identifiers, when the shared sandbox token is supplied.
- Choice writes verify that a translation exists but do not compare its owner with an authenticated user.
- Option creation likewise has no owner check.
- No user session, bearer-token identity, role, or ownership middleware exists in the inspected Express route.
- The API listens on localhost in the current service entry point; it must remain private until a production authentication model is implemented.

## Recommended authorization policy to implement

The following is the conservative default recommendation, not an assertion about current product policy:

1. **Authenticated ownership:** New user-created translations must have a non-null `owner_id` equal to the authenticated `user_accounts.user_id`.
2. **Write access:** Only the owner may modify translation metadata, word choices, Other options, or lemma defaults. Every mutation must authorize inside the same transaction as the write to avoid time-of-check/time-of-use gaps.
3. **Private-by-default reads:** Translation details, choices, exports, and reading views should be private to the owner unless a future explicit share/publication model grants access.
4. **Legacy NULL-owner rows:** Do not silently assign them to an account or make them editable by all authenticated users. Preserve them and initially treat them as read-only pending a row-level inventory and Kit's decision on whether they are public, archived, or assignable.
5. **No implicit sharing:** A translation ID, forum membership, username match, or knowledge of a URL never grants write access.
6. **No client-supplied owner:** Ignore or reject `owner_id` and `user_id` values supplied by the browser for authorization purposes. Derive identity only from verified server-side credentials.
7. **Forum separation:** Forum identity remains separate. Any future cross-link is explicit account linking, not username matching.

### Important compatibility issue

The legacy Flask `/choice` handler stores a dropdown item index and also records a forward-only lemma default; it can create an Other option. The current Express choice route stores a numeric byte directly and does not reproduce all legacy behavior. Authentication alone does not make the Express write route a safe replacement. Preserve the legacy semantics in the canonical API or prove an explicit data-model conversion before migration.

## Authentication architecture recommendation

Keep one identity authority and avoid two independently mutable account/session systems.

Preferred sequence:

1. Reuse the existing `user_accounts` table and Werkzeug password hashes as the initial credential store, after backup and hash-format inventory.
2. Add a hardened login/registration boundary: stronger password policy, rate limiting, generic login failures, CSRF protection for cookie-authenticated browser requests, secure session/token lifecycle, and account deactivation enforcement.
3. Issue a short-lived, audience-restricted credential for core API calls, or keep all authenticated writes behind the same identity service. The Express API must validate signature, issuer, audience, expiry, and account active status. A shared sandbox token is not a substitute.
4. Keep signing keys and database URLs server-side only. Prefer asymmetric signing so the API can verify identity without receiving the credential-issuing private key.
5. Define CORS as an explicit allowlist. If cookies are used cross-origin, specify Secure, HttpOnly, SameSite, credentialed CORS, and CSRF/origin checks together; do not enable wildcard CORS with credentials.
6. Add audit events for authentication and authorization failures without logging passwords, cookies, tokens, or authorization headers.

The exact bearer-token versus cookie-session choice depends on the final frontend/API hostnames and deployment topology. Do not pick cookie attributes before the domain relationship is known.

## Required test matrix before public authoring

- Anonymous user cannot create, edit, or export private translations.
- User A can read/write only User A's private translations.
- User B cannot read, modify, export, or infer User A's private translation content.
- A guessed translation ID does not bypass authorization.
- Inactive accounts cannot authenticate and existing credentials are rejected after deactivation.
- Expired, malformed, wrong-audience, wrong-issuer, and invalid-signature tokens are rejected.
- Missing/invalid CSRF tokens and disallowed origins are rejected for cookie-authenticated state changes.
- Legacy NULL-owner translations remain unchanged and follow the explicitly approved legacy policy.
- Every mutation (choice, Other option, lemma default, translation metadata) is transactionally authorized.
- Concurrent Other-option creation cannot produce duplicate ordering or bypass ownership.
- Existing Werkzeug hashes verify without rewriting them; password rehashing, if needed, occurs only after successful login and is separately tested.
- Session/token revocation and secret rotation behavior are documented and tested.

## Work intentionally deferred

- No password hash was read, exported, or copied.
- No account or translation rows were queried or modified.
- No production secret, environment variable, database grant, or service configuration was changed.
- No login or authoring route was modified.
- No forum identity linking was attempted.
- No public exposure or deployment was performed.

## Source references

- `bible-project/website/app_v2.py`: Flask account/session and translation handlers.
- `BibleApp/artifacts/api-server/src/app.ts`: Express middleware and CORS.
- `BibleApp/artifacts/api-server/src/routes/bible.ts`: sandbox-token gate and authoring handlers.
- `BibleApp/artifacts/api-server/src/routes/index.ts`: route mounting and middleware scope.
- `bible-project/website/DEPLOYMENT.md`: portable Flask environment contract and current deployment blockers.
