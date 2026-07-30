# ADR 0013: Environment Variable and Secret Handling

## Status

Accepted with follow-up required for market-provider key classification

## Context

Atlas needs runtime mode, database, provider, logging, and deployment configuration without committing secrets or leaking confidential values to browser bundles and diagnostics.

## Decision

Treat `.env.example` as a names-only contract; keep values out of source. Validate required server configuration centrally, redact sensitive keys/URLs from logs, and scan releases for sensitive material. Treat all `VITE_*` variables as public browser configuration. Classify current `VITE_FINNHUB_API_KEY` and `VITE_TWELVEDATA_API_KEY` before using them as confidential credentials.

## Consequences

Server configuration is reviewable without secret values and release scans reduce accidental disclosure. External secret storage/rotation remains an operator concern. Confidential provider keys must move behind Functions or be replaced by intentionally public, tightly constrained keys through approved work.

## Related files or systems

`.env.example`, `.gitignore`, `lib/config/environment.js`, `lib/logging/logger.js`, `scripts/release-verify.mjs`, `vite.config.js`.
