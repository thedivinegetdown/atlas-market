# Read-only authenticated production smoke

P10 provides a deterministic browser smoke for the documented Atlas workspace routes and production health boundaries. It uses Node 22 plus an installed Chromium browser; no browser-test dependency is added.

## Safety contract

The runner enables Chrome DevTools request interception before opening Atlas. Only `GET`, `HEAD`, and `OPTIONS` may continue. Any `POST`, `PUT`, `PATCH`, or `DELETE` is blocked in the browser before network dispatch, recorded as a safety failure, and makes the smoke fail. The runner contains no order, review-save, evaluation, observation, portfolio, watchlist, settings, or configuration mutation call.

It never reads browser cookies or local/session storage and never accepts a bearer token or password option. It reads the public shell HTML only in memory to distinguish entry assets from lazy chunks and checks known workspace labels in the DOM; response bodies and page content are not copied into evidence. Authentication is inherited only from an owner-authorized existing browser session/profile. If the session is absent, expired, or cannot pass the protected health read, the command fails closed.

## Run

Use a dedicated, already authenticated Chromium profile. The profile must not be open in another browser process.

```powershell
$env:ATLAS_SMOKE_USER_DATA_DIR = 'C:\approved\atlas-smoke-profile'
npm run smoke:production
```

Alternatively, start an authorized dedicated browser with remote debugging and connect without copying session material:

```powershell
$env:ATLAS_SMOKE_CDP_URL = 'http://127.0.0.1:9222'
npm run smoke:production
```

Optional inputs are `ATLAS_SMOKE_BASE_URL`, `ATLAS_SMOKE_BROWSER`, `ATLAS_SMOKE_PROFILE_DIRECTORY`, `ATLAS_SMOKE_OUTPUT`, and `ATLAS_SMOKE_TIMEOUT_MS`; equivalent `--name=value` arguments are supported. The default target is `https://atlas-market.netlify.app`.

Without an authorized session/profile, the command still proves public health and unauthenticated protected-health denial, then emits `PRODUCTION_PROOF: PENDING` and exits nonzero. It does not attempt sign-in or accept credentials.

## Sanitized evidence

The default output is an ignored `artifacts/production-smoke/<UTC timestamp>.json` file with owner-only file mode where supported. Evidence includes only:

- target origin and timestamps;
- public health status and unauthenticated protected-health status;
- authenticated workspace/protected-health booleans;
- each documented route's navigation, direct refresh, script/lazy-asset counts, and failure counts;
- sanitized failed-request path/status/type, console error category/source/fingerprint metadata, and blocked non-read-only request metadata;
- aggregate pass/pending result.

Headers, bodies, cookies, bearer/CSRF values, passwords, callback values, browser storage, user identity, tenant/account identifiers, page content, and raw console messages are never collected or written.
