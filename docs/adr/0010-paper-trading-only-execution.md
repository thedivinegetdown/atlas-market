# ADR 0010: Paper-Trading-Only Execution

## Status

Accepted; invariant

## Context

Atlas supports order entry, fills, positions, P&L, reconciliation, journal, and reports, which could be mistaken for real-money execution capability.

## Decision

All order behavior is simulated. Validate paper mode at configuration and request boundaries, use paper broker/execution engines, and expose explicit `paperTrading`, `liveOrders`, and `brokerExecution` semantics. Do not include a live broker adapter or order-routing edge.

## Consequences

Users can exercise trading workflows without financial execution. Simulation results cannot guarantee real outcomes. Any live brokerage proposal changes the trust, regulatory, security, and risk model and requires a superseding ADR before implementation.

## Related files or systems

`.env.example`, `lib/broker/paperBroker.js`, `lib/broker/executionSimulator.js`, `lib/orders/`, `lib/trading/`, `netlify/functions/submit-paper-order.js`, `tests/paperBroker.test.js`, paper workflow tests.
