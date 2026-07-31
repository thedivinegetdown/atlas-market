# ADR 0013: Environment Variable and Secret Handling

## Status

Accepted

## Context

Atlas needs runtime mode, database, provider, logging, and deployment configuration without committing secrets or leaking confidential values to browser bundles and diagnostics.

## Decision

Treat `.env.example` as a names-only contract; keep values out of source. Validate required server configuration centrally, redact sensitive keys/URLs from logs, and scan releases for sensitive material. Treat all `VITE_*` variables as public browser configuration. Provider credentials use only server-side `FINNHUB_API_KEY` and `TWELVEDATA_API_KEY`; browser-prefixed provider-key aliases are not accepted.

## Consequences

Server configuration is reviewable without secret values and release scans reduce accidental disclosure. External secret storage/rotation remains an operator concern. Provider-backed historical intelligence stays behind an authenticated Netlify Function; public browser code receives only the minimal derived read model and never raw candle history.

## Related files or systems

`.env.example`, `.gitignore`, `lib/config/environment.js`, `lib/logging/logger.js`, `scripts/release-verify.mjs`, `vite.config.js`.
