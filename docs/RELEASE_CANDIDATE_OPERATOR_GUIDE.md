# Atlas Market Release Candidate Operator Guide

This guide describes how to operate and review the Atlas Market paper-trading release candidate after Parts 14A through 15F.

Atlas Market is currently a paper-trading operating system. It does not place live orders, connect to a real brokerage account, or execute real brokerage trades. The release candidate is designed to validate the institutional workspace, event lifecycle, adapter contracts, analytics engines, safety gates, and release readiness flow before future production integrations.

Related documents:

- [Trading OS Architecture ADR](adr/0001-trading-os-architecture.md)
- [Release Checklist](RELEASE_CHECKLIST.md)
- [Event Bus Guide](EVENT_BUS_GUIDE.md)
- [Event Bus Verification Checklist](EVENT_BUS_VERIFICATION_CHECKLIST.md)

## Operator Scope

Use this guide when reviewing, demoing, or preparing the paper-trading release candidate.

The operator should verify:

- Paper trading mode is active.
- Mock market data and mock broker adapters are active.
- No live broker integration is present.
- Dashboard panels render release, adapter, lifecycle, risk, and analytics state.
- Event outputs are present and consistent.
- `npm test` and `npm run build` pass before release review.

This guide is authoritative for release-candidate operation. The checklist remains the merge/deploy control, while this guide explains what the operator is validating and why.

## Operator Procedure

Follow this sequence for every release-candidate review:

1. Confirm the branch is `part-10-trading-workspace` and the working tree only contains intentional release-candidate changes.
2. Review `.env.example` and the active environment for `TRADING_MODE=paper`.
3. Start the workspace locally only after tests and build have been run for the candidate under review.
4. Inspect the Market Data Health and Broker Adapter Health panels before reviewing trading panels.
5. Confirm Release Readiness is `ready` and RC Stabilization is `stable`.
6. Review the Event Timeline from adapter checks through release stabilization.
7. Confirm rejected paper trades do not produce filled executions, accounting updates, or performance inclusion.
8. Record command output for `npm test` and `npm run build` in the release notes or PR.
9. Treat any live brokerage capability, real order-routing flag, missing paper flag, failed event contract, or failed build/test command as a release blocker.

## Architecture Overview

Atlas Market uses an asset-agnostic, event-driven architecture:

- React + Vite renders the institutional workspace.
- Netlify Functions are the API boundary for workspace and trading data.
- PostgreSQL persistence is accessed server-side through repository and persistence modules.
- Engines perform business logic outside UI components.
- Asset profiles define quantity labels, tick sizes, precision, and margin assumptions.
- Adapters isolate external system boundaries.
- Paper trading remains the default and only executable mode.

The current release candidate keeps external dependencies intentionally conservative:

- Market data uses the mock market data adapter by default.
- Brokerage behavior uses the mock paper broker adapter by default.
- Execution uses the paper execution simulator.
- Accounting updates paper account state only.
- Journal, performance, risk, and release gates consume paper lifecycle outputs.

## Complete Event Lifecycle

The primary release-candidate event flow is:

1. `marketData.adapter.checked`
   Mock market data adapter health is evaluated.

2. `broker.adapter.checked`
   Mock paper broker adapter health is evaluated.

3. `portfolio.risk.evaluated`
   Portfolio risk is calculated from asset-agnostic demo portfolio state.

4. `trade.positionSize.recommended`
   Position sizing recommends a paper quantity before guardrails and execution.

5. `trade.guardrail.evaluated`
   Proposed paper trades are approved or rejected before they can enter execution simulation.

6. `trade.execution.simulated`
   Approved proposed trades are converted into simulated fills. Rejected guardrails do not produce fills.

7. `portfolio.accounting.updated`
   Simulated fills update paper cash, equity, positions, and realized P&L.

8. `trade.journal.recorded`
   The paper trade journal records the full proposed trade, guardrail, execution, and accounting chain.

9. `portfolio.performance.evaluated`
   Filled, recorded paper trades are included in performance analytics. Rejected and non-filled trades are excluded.

10. `portfolio.analytics.updated`
    Portfolio composition, exposure, concentration, and diversification are evaluated.

11. `portfolio.riskAdjustedPerformance.evaluated`
    Return quality, drawdown, volatility, and recovery quality are evaluated.

12. `portfolio.drawdownProtection.evaluated`
    Drawdown protection recommends whether paper trading may continue, reduce risk, or pause.

13. `portfolio.capitalAllocation.recommended`
    Capital allocation recommendations are produced without generating trades.

14. `portfolio.rebalance.recommended`
    Rebalancing recommendations are produced without automatic execution.

15. `strategy.attribution.evaluated`
    Journaled paper trades are attributed to strategies and signals.

16. `strategy.portfolioManager.evaluated`
    Multi-strategy coordination checks priority, exposure, risk budgets, duplicate symbols, and conflicts.

17. `ai.decision.orchestrated`
    The AI decision orchestrator combines signal, risk, sizing, allocation, drawdown, guardrail, and performance context into a final paper decision.

18. `system.releaseReadiness.evaluated`
    Production readiness evaluates environment, adapters, event contracts, paper safety, and test/build status.

19. `system.releaseCandidate.stabilized`
    Release candidate stabilization evaluates regression coverage, critical module health, dashboard smoke checks, event pipeline integrity, paper safety lock, mock-mode adapters, and release blockers.

Older event bus documentation also covers repository and UI refresh events such as `order:created`, `order:updated`, `order:cancelled`, `portfolio:updated`, and `journal:created`.

Operator evidence to capture:

- Event type names are present exactly as emitted by the engines.
- Timestamps are present and parseable.
- The release readiness event appears before the stabilization event.
- The stabilization event includes no `releaseBlockers`.
- Any caution is documented with a disposition before release review continues.

## Engine Responsibility Map

| Area | Module | Responsibility |
| --- | --- | --- |
| Market data adapter | `lib/market/marketDataAdapter.js` | Mock market data adapter interface, health, quote/candle/symbol normalization |
| Broker adapter | `lib/brokers/brokerAdapter.js` | Mock paper broker adapter interface, account/position/order/response normalization |
| Signal intelligence | `lib/signals/signalEngine.js` | Quote-level signal evaluation and explainable signal fields |
| AI decision intelligence | `src/core/ai/aiDecisionOrchestrator.js` | Combines scanner, risk, sizing, allocation, drawdown, guardrail, and performance context |
| Portfolio risk | `src/core/risk/portfolioRiskEngine.js` | Asset-agnostic portfolio risk evaluation |
| Trade guardrails | `src/core/risk/tradeGuardrailEngine.js` | Pre-execution paper trade safety checks |
| Position sizing | `src/core/risk/positionSizingEngine.js` | Fixed-risk and constraint-aware paper quantity recommendation |
| Drawdown protection | `src/core/risk/drawdownProtectionEngine.js` | Equity peak, drawdown, daily/weekly loss threshold protection |
| Execution simulation | `src/core/execution/executionSimulationEngine.js` | Paper-only market, limit, stop, and stop-limit fill simulation |
| Paper accounting | `src/core/accounting/paperPortfolioAccountingEngine.js` | Cash, equity, position, average price, and realized P&L updates from simulated fills |
| Trade journal | `src/core/journal/paperTradeJournalEngine.js` | Normalized paper lifecycle record and event chain snapshot |
| Performance analytics | `src/core/analytics/paperPerformanceAnalyticsEngine.js` | Win rate, expectancy, profit factor, and realized P&L from journal records |
| Portfolio analytics | `src/core/analytics/portfolioAnalyticsEngine.js` | Exposure, concentration, diversification, and drift |
| Risk-adjusted performance | `src/core/analytics/riskAdjustedPerformanceEngine.js` | Sharpe-style, Sortino-style, drawdown, volatility, and grade |
| Capital allocation | `src/core/analytics/capitalAllocationEngine.js` | Strategy, asset class, symbol, risk budget, and cash buffer recommendations |
| Rebalancing | `src/core/analytics/portfolioRebalanceRecommendationEngine.js` | Recommendation-only add, reduce, hold, and review actions |
| Strategy attribution | `src/core/analytics/strategyAttributionEngine.js` | Strategy-level performance attribution |
| Strategy manager | `src/core/strategy/multiStrategyPortfolioManager.js` | Strategy registry, conflicts, duplicates, exposure limits, and risk budgets |
| Release readiness | `lib/system/releaseReadiness.js` | Environment, adapter, event contract, paper safety, and test/build gate |
| RC stabilization | `lib/system/releaseCandidateStabilization.js` | Final release candidate stability, smoke, module, event, mock-mode, and blocker summary |

## Paper-Trading Safety Model

The safety model is intentionally layered:

- Environment validation only accepts `TRADING_MODE=paper`.
- Broker adapter metadata reports `paperTrading: true` and `liveOrders: false`.
- Guardrails reject unsafe proposed paper trades before simulation.
- Execution simulation rejects trades that were not guardrail-approved.
- Accounting rejects updates when simulated execution is not filled.
- Journal records rejected or non-filled lifecycles but performance analytics excludes them.
- Release readiness validates paper-trading safety across adapters, guardrails, and executions.
- Release candidate stabilization verifies the paper-trading safety lock before final stable status.

Operators should treat any live order flag, non-paper trading mode, or real broker provider as a release blocker.

Paper-trading-first language is not cosmetic. It is the release boundary. The current candidate validates the operating system, event contracts, risk controls, analytics, adapters, and dashboard workflow without enabling external execution. Future live-trading readiness must be handled as a separate approval track with product, security, compliance, operational, and broker-specific review.

## Adapter Mock-Mode Behavior

The current adapters are release-candidate foundations:

- Market data adapter: `mock-market-data-adapter`
- Broker adapter: `mock-paper-broker-adapter`

Expected behavior:

- Adapters report health without requiring paid APIs or broker credentials.
- Adapter responses are normalized for asset-agnostic consumers.
- Mock adapters are the default providers.
- Broker adapter output is derived from paper execution and accounting outputs.
- No adapter should send orders to a real broker.
- No adapter should expose secrets in UI or logs.

Adapter mock-mode verification is included in `system.releaseCandidate.stabilized`.

Mock mode means adapters may normalize, simulate, and report health, but they must not place orders, mutate a real brokerage account, or require paid provider credentials to operate the release candidate. A future provider may be added behind these contracts, but the default release-candidate path remains mock and paper-only.

## Dashboard Operation

The release candidate workspace includes panels for:

- Market Data Health
- Broker Adapter Health
- Release Readiness
- RC Stabilization
- Scanner / Signal
- AI Decision Orchestrator
- Risk
- Position Sizing
- Trade Guardrails
- Execution Simulation
- Paper Accounting
- Paper Trade Journal
- Paper Performance
- Risk-Adjusted Performance
- Drawdown Protection
- Capital Allocation
- Multi-Strategy Manager
- Strategy Attribution
- Portfolio Analytics
- Rebalancing Recommendations
- Event Timeline
- Position Risk

The operator should confirm the Release Readiness panel is `ready` and the RC Stabilization panel is `stable` before considering the build a release candidate.

## Testing And Build Validation

Required commands:

```bash
npm test
npm run build
```

Expected behavior:

- `npm test` exits successfully.
- `npm run build` exits successfully.
- No failing Vitest files remain.
- No production build errors remain.
- The Release Readiness panel summarizes test/build status.
- The RC Stabilization panel summarizes dashboard smoke and event pipeline status.

Validation evidence:

- Save the command names, pass/fail result, and any warning requiring operator review.
- A passing workspace panel is not a substitute for command-line validation.
- Failed tests, failed builds, unresolved TypeScript/Vite errors, or missing release events block release-candidate approval.

## Release Checklist

Use [Release Checklist](RELEASE_CHECKLIST.md) as the canonical checklist.

For this release candidate, the operator should additionally verify:

- Branch is `part-10-trading-workspace`.
- `system.releaseReadiness.evaluated` is visible in the dashboard.
- `system.releaseCandidate.stabilized` is visible in the dashboard.
- Release blocker list is empty.
- Paper safety lock is stable.
- Adapter mock mode is stable.
- Event pipeline integrity is stable.
- Critical module health is stable.
- Dashboard smoke summary is stable.

## Known Limitations

Current limitations are intentional for a paper-trading release candidate:

- No live brokerage connection.
- No live orders.
- No real account synchronization.
- No paid market data dependency.
- Mock adapters are default.
- Dashboard data is demo-backed for release-candidate validation.
- Multi-user accounts are not enabled.
- Authentication and authorization are not production-user complete.
- Alerts and scanners are foundations, not real-time automation systems.
- AI decisioning is deterministic engine orchestration, not external LLM execution.
- Release readiness panels summarize configured validation targets; operators must still run `npm test` and `npm run build` before release review.
- The workspace does not provide a live production incident runbook yet.
- Phase 15F documentation does not change engine behavior, adapter behavior, persistence behavior, or API contracts.

## Phase 16 Roadmap

Phase 16 should build on the release candidate without weakening paper-trading safety.

Recommended sequence:

1. API and workspace documentation pass
   Align Netlify endpoints, workspace panels, adapters, and operator docs.

2. Persistence hardening
   Verify PostgreSQL migrations, repository contracts, seed/demo modes, and local/prod environment differences.

3. Authentication foundation
   Introduce user identity, account scoping, and request authorization before any real account features.

4. Real-time data pilot
   Add a non-trading live data provider behind the market data adapter interface while preserving mock defaults.

5. Broker integration design review
   Add broker adapter contract tests for a future provider without enabling live order routing.

6. Paper trade replay and backtesting
   Reuse journal, accounting, performance, risk, and event lifecycle outputs for historical replay.

7. Alert and scanner automation controls
   Keep alerts/scanners recommendation-only until safety, auth, and audit controls are in place.

8. Operator audit log
   Persist release, readiness, adapter, and lifecycle events for review.

9. Production release gate
   Require release readiness and RC stabilization outputs plus CI status before deployment.

10. Live trading readiness review
   Treat live trading as a separate future milestone requiring explicit product, security, compliance, and operational approval.
