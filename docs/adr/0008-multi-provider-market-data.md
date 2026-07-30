# ADR 0008: Multi-Provider Market Data Architecture

## Status

Accepted (retrospective)

## Context

Market availability, payload shape, entitlements, quotas, latency, and streaming capability vary by provider. Domain logic must not depend on a single vendor response.

## Decision

Place provider clients behind a common contract, registry, adapter, and normalization layer. Represent Finnhub, Twelve Data, and mock behavior as replaceable providers. Keep cache, polling, streaming, WebSocket adaptation, freshness, gap recovery, health, and scanner coordination as separate engines.

## Consequences

Providers can evolve without rewriting workspace/domain contracts, and deterministic mock behavior supports testing. Contract versions, symbol semantics, timestamp normalization, quotas, and production credentials require active governance.

## Related files or systems

`lib/market/providerContract.js`, `lib/market/providerRegistry.js`, `lib/market/marketDataAdapter.js`, `lib/market/marketNormalizer.js`, `lib/market/finnhubClient.js`, `lib/market/twelveDataClient.js`, `lib/market/mockMarketDataProvider.js`.
