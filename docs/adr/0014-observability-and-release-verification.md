# ADR 0014: Observability and Release Verification

## Status

Accepted (retrospective)

## Context

A broad serverless and provider-dependent platform needs safe diagnostics and a repeatable release gate without exposing sensitive or high-cardinality content.

## Decision

Use structured JSON logging, recursive redaction, request/event correlation, readiness checks, provider/paper-operation health models, and review-only diagnostics. Use `npm run release:verify` as the broad local release gate for configuration, focused and full tests, lint baseline, build, performance, migration safety, sensitive-material scan, generated artifacts, and git state. Keep rollback guidance human-controlled.

## Consequences

Releases have deterministic evidence and diagnostics avoid raw sensitive payloads. CI currently covers only tests and build, and no centralized telemetry/SLO backend is established; alignment and operational alerting remain roadmap work.

## Related files or systems

`lib/logging/`, `lib/observability/`, `lib/system/release*`, `src/components/ReleaseDiagnosticsPanel.jsx`, `scripts/release-verify.mjs`, `scripts/check-build-performance.mjs`, `.github/workflows/ci.yml`, release docs.
