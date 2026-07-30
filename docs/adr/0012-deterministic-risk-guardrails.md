# ADR 0012: Deterministic Risk Guardrails

## Status

Accepted; invariant

## Context

Paper workflows still need predictable limits, sizing, drawdown protection, rejection semantics, and safe interaction with market and AI inputs.

## Decision

Implement risk limits, kill-switch state, position sizing, portfolio risk, drawdown protection, and trade guardrails as deterministic engines. Risk evaluation precedes simulated execution and cannot be overridden by provider or AI output.

## Consequences

Risk decisions are reproducible and testable. Policy changes affect public behavior and require explicit acceptance criteria; relaxing vetoes or introducing non-deterministic risk authority requires an approved ADR.

## Related files or systems

`lib/risk/`, `src/core/risk/`, `netlify/functions/risk-summary.js`, `netlify/functions/realtime-paper-risk.js`, `tests/riskEngine.test.js`, risk engine tests.
