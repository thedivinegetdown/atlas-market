# Atlas API Authentication and CSRF Protection

Status: AUTH.2 source implementation complete; deployed verification pending

Verified in source: 2026-08-13

## Control responsibilities

- **Authentication** verifies the Netlify Identity bearer session and establishes the Atlas user. A CSRF token never grants authentication.
- **Authorization** evaluates the safe Atlas role and, where applicable, the authoritative organization/team membership. Identity role metadata does not fabricate tenant membership.
- **Tenant scope** requires organization and account context, includes the authenticated user, and adds team context where the canonical repository supports it.
- **CSRF** is defense in depth for authenticated browser mutations. It is independent of authentication and tenant authorization.

The browser normally sends an `Authorization: Bearer` header, which is not ambient browser authority in the same way as a cookie. Atlas nevertheless retains CSRF because the authentication boundary can also read the Netlify `nf_jwt`/Atlas session cookie and because mutation defense should not depend on one browser transport assumption. CSRF does not mitigate XSS; safe rendering, token non-exposure, and session expiry remain required.

## Token lifecycle and transport

1. The authenticated browser requests `GET /.netlify/functions/csrf-token` with its current bearer token.
2. The Function verifies identity and authorization before issuing anything.
3. The server generates a random nonce and signs claims bound to the verified user ID, session ID, session token hash, issue time, and expiration. The signing key is derived from the verified bearer/session material using Node cryptography; no database, Redis, dependency, or new secret is introduced.
4. The token expires after at most ten minutes and never outlives the authenticated session.
5. The browser keeps the token only in the API-client closure. It is not placed in UI, URL state, analytics, logs, or persistent browser storage.
6. POST/PUT/PATCH/DELETE requests receive the token automatically in `x-csrf-token`. Reads do not bootstrap or attach it.
7. A `csrf_invalid` or `csrf_expired` response clears the cached token, establishes one replacement, and retries once. A second denial is returned without another retry.
8. Logout clears local CSRF state. A changed bearer token also clears it, preventing cross-user reuse.

Validation rejects missing, malformed, oversized, expired, wrongly signed, wrong-user, wrong-session, and wrong-bearer tokens using timing-safe signature comparison. Public errors contain stable codes only: `csrf_required`, `csrf_invalid`, or `csrf_expired`. The deterministic local-auth placeholder accepted by historical suites exists only when `NODE_ENV=test` and the session is explicitly marked `localDevelopmentOnly`; provider-backed and production sessions always use cryptographic validation.

## Endpoint policy after AUTH.2

The generated API inventory is authoritative for source classification.

- The former 12 P0 mutations use organization-authenticated controls, owner/admin workspace-write authorization, account context, and CSRF. Legacy paper-order, scanner/alert, and portfolio mutations are `COMPATIBILITY_ONLY`; PI.3/PI.4 remain canonical.
- The former eight P1 reads use organization membership and account/user scope. Operator actions, system events, and workspace configurations use scoped persistence APIs. Legacy process-memory projections remain non-canonical and are not durable across serverless instances.
- Database and release runtime diagnostics require authenticated `workspace.admin` access.
- `health` and `watchlist` intentionally remain `PUBLIC_READ`. They mutate nothing and expose neither tenant data nor privileged operational diagnostics.
- Team-authenticated endpoints continue to use the existing organization-plus-team repository boundary. CSRF success cannot override organization, account, user, role, or team denial.

## Origin policy and observability

Authenticated requests accept local development origins plus the exact origins represented by Netlify `URL`, `DEPLOY_URL`, and `DEPLOY_PRIME_URL`. An unrecognized supplied origin fails closed. This supports deploy previews without a wildcard authenticated-origin policy.

Existing structured API observability records safe authentication, authorization, CSRF, tenant, and request outcomes. Compatibility mutation success adds a safe route/request/organization/account event. Authorization headers, bearer/access/refresh tokens, CSRF values, passwords, callback tokens, and signing material are never logged.

## Deferred deployed smoke procedure

Run only in a separately approved deploy-preview/final-E2E phase with synthetic paper state:

1. Sign in with an invited non-production Identity user and verify an authenticated read.
2. Observe a successful CSRF bootstrap without displaying or recording the token value.
3. Perform one reversible paper/test mutation and confirm the protected success envelope.
4. Confirm the same read and mutation reject an unauthenticated browser.
5. Send a deliberately invalid CSRF value and confirm `403 csrf_invalid` without token detail.
6. Confirm a viewer can read but cannot mutate and a tenant mismatch is denied.
7. Log out, then confirm authenticated reads fail and the old browser session/CSRF combination cannot be reused.
8. Repeat after login as a different user to confirm a fresh CSRF bootstrap.

Do not use live trading, a broker, production financial data, or production mutation state for this smoke.

## Remaining release evidence

AUTH.1 browser login, invitation, recovery, refresh, expiry, and logout still require successful deployed Netlify verification. AUTH.2 also requires the above deploy-preview authenticated smoke and final production-safe E2E evidence. Repository tests do not prove Identity email delivery, deployed environment/origin values, or live tenant membership configuration.
