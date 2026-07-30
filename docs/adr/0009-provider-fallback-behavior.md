# ADR 0009: Provider Fallback and Degraded Behavior

## Status

Accepted (retrospective)

## Context

Provider outages, stale data, quota failures, and malformed responses must not crash the shell or silently corrupt paper-trading analysis.

## Decision

Use explicit resilience, failover, freshness, cache, and recovery engines. Fallback results retain provider provenance and health/degraded metadata. Missing configuration or exhausted providers may produce mock, degraded, or unavailable states; fallback cannot bypass validation or represent stale data as current.

## Consequences

Optional data failures can be contained, but operators and UI must distinguish primary, fallback, stale, mock, and unavailable states. In-memory cache/session guarantees do not extend across serverless instances.

## Related files or systems

`lib/market/marketDataService.js`, `lib/market/marketDataProviderResilienceEngine.js`, `lib/market/marketDataProviderFailoverEngine.js`, `lib/market/marketDataFreshnessGapRecoveryEngine.js`, `lib/market/marketDataCacheEngine.js`, provider reliability tests.
