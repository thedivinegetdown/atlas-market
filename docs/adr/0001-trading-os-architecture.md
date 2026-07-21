# ADR 0001: Trading OS Architecture

## Status

Accepted

## Context

Atlas Market is evolving from a paper-trading workspace into a production-grade trading operating system. The platform must support current equity paper trading while remaining ready for future real-time data, broker integrations, AI assistants, multi-user accounts, scanners, alerts, backtesting, and plugin-style extensions.

## Decision

Atlas Market uses an asset-agnostic, API-first architecture.

Core decisions:

- Asset behavior is modeled through asset profiles instead of hard-coded equity assumptions.
- Paper trading is the default trading mode.
- React + Vite owns the workspace UI.
- Netlify Functions expose workspace and trading APIs.
- PostgreSQL persistence is accessed server-side through repository and persistence modules.
- Engines remain modular for signals, risk, orders, portfolio, analytics, and journal behavior.
- API clients call server functions instead of importing server-side repositories directly.
- Future brokers, asset classes, data providers, scanners, alerts, assistants, and background jobs should connect through adapters rather than rewriting the workspace contract.
- Atlas AI provider adapters run only behind server-side descriptors. OpenAI, Anthropic, Google, and local/self-hosted HTTP providers share the `generateText`, `generateStructured`, `healthCheck`, and `estimateUsage` contract, alongside mock and disabled providers.
- Atlas AI routing is deterministic and server-authoritative. Category, model allowlists, provider health, structured-output support, retry and fallback eligibility, fallback depth, timeout state, and budget estimates decide the route; browser input cannot supply arbitrary provider URLs or model identifiers.
- Atlas AI responses are evaluated deterministically before persistence. Schema, required fields, advisory-only and paper-trading-only language, limitations, grounding risk, prohibited actions, HTML/script contamination, confidence consistency, fallback metadata, and provider validation status are reduced to compact audit-safe metadata.
- Atlas AI streaming uses provider-neutral started, chunk, completed, error, and cancelled events with correlation and session identifiers. Final records are marked complete only after the structured response has passed the existing validation and evaluation pipeline.
- Atlas AI conversation memory is bounded by tenant, account, user, and session. Older turns become sanitized summaries with expiration metadata; raw prompts, raw provider responses, vector databases, embeddings, and unlimited long-term memory are excluded from this architecture.
- Atlas AI usage controls estimate tokens and cost, track authorized daily and monthly summaries, and degrade AI assistance when budgets are exhausted without interrupting deterministic Atlas workflows.
- Atlas opportunity analysis is an advisory workflow over existing Atlas market and paper-trading context. Deterministic preprocessing validates symbols, timeframes, limits, stale data, baseline ranks, hard rejections, and no-trade conditions before AI-assisted interpretation is allowed.
- Atlas opportunity APIs preserve authentication, authorization, tenant isolation, account scoping, correlation identifiers, safe errors, and paper-trading boundaries. Client input cannot provide arbitrary providers, models, tenant authority, account authority, or mutation instructions.
- Atlas opportunity persistence stores compact sanitized summaries, fingerprints, ranks, exclusions, no-trade decisions, usage estimates, context fingerprints, and retention metadata; raw provider payloads, prompts, credentials, authorization headers, chain-of-thought, executable instructions, and live-trading state are excluded.
- Atlas opportunity ranking is deterministic and reproducible from validated inputs. Component contributions cover scanner quality, freshness, supporting evidence, risk severity, invalidation clarity, liquidity, strategy compatibility, data completeness, provider fallback/degradation, and evaluator warnings. Scores and confidence values are bounded, and unsafe or rejected opportunities remain non-actionable.
- Atlas opportunity explainability separates observed Atlas data from AI interpretation. Explanations include positive contributors, negative contributors, stale or missing data, source timestamps, fallback/evaluation warnings, limitations, and version metadata without exposing prompts, raw provider payloads, private reasoning, secrets, or chain-of-thought.
- Atlas opportunity review workflow stores only human review metadata: `new`, `reviewing`, `saved`, `dismissed`, and `expired` states plus bounded sanitized notes and optional feedback. Review state changes require server-side tenant/account/user authorization and cannot prepare, place, modify, cancel, or route trades.
- Atlas opportunity history supports bounded tenant-safe filtering by symbol, category, timeframe, review state, ranking tier, and date range. Expired and dismissed records stay distinct, and dismissal preserves audit history.
- Atlas portfolio intelligence aggregates paper positions, risk analytics, watchlists, signals, and opportunity summaries into deterministic portfolio health snapshots. Diversification, concentration, allocations, P&L summaries, volatility estimates, exposure, stale data, missing data, confidence, and risk tiers are computed by Atlas math, not model output.
- Atlas portfolio AI insights reuse the existing gateway and `portfolio_summary` contract. Observed portfolio data remains separate from interpretation, and model output cannot produce price predictions, guaranteed outcomes, trade recommendations, broker actions, orders, or autonomous workflows.
- Atlas portfolio intelligence history stores compact tenant/account/user-scoped snapshots with score, risk tier, category, symbols, limitations, and AI status. Raw prompts, raw provider payloads, credentials, authorization headers, private URLs, stack traces, and chain-of-thought are excluded.
- Atlas frontend delivery defers heavyweight advisory and release panels behind feature-level lazy boundaries. Atlas Copilot, Opportunity Review, Portfolio Intelligence, and Release Diagnostics load through dynamic imports with accessible loading/failure states, while the paper-trading shell and deterministic dashboard remain immediately available.
- Atlas bundle strategy uses conservative Vite/Rolldown chunks for React, major engine families, AI panels, release diagnostics, and system groups. Deferred feature chunks are excluded from initial modulepreload hints, and `npm run performance:check` enforces eager-load budgets after production builds.
- Atlas release-candidate readiness separates liveness from readiness. Liveness covers only runtime and paper-trading boundary health; readiness adds required configuration, API reliability, migration compatibility, optional AI availability, paper-trading service health, performance budget, and safe release metadata.
- Atlas observability records are structured, redacted, and bounded-cardinality. Route, category, and status labels are normalized; raw prompts, raw provider responses, credentials, authorization headers, private URLs, stack traces, chain-of-thought, and tenant-sensitive payloads are excluded.
- Atlas release verification is a deterministic local command, `npm run release:verify`, that validates configuration, tests, lint warning baseline, production build, performance budget, migration safety, sensitive-material scans, generated artifacts, and git state without network access, deployment, provider calls, or production data mutation.
- Atlas rollback readiness is advisory and human-controlled. The architecture supports prior frontend deployment restoration, function forward-fix, configuration correction, migration compatibility hold, AI-provider degraded mode, and performance regression blocking without destructive downgrade migrations or automatic rollback execution.

## Consequences

Positive outcomes:

- Existing stock and ETF paper workflows remain stable.
- Forex, crypto, futures, and options can be introduced through profiles and adapters.
- API guardrails, observability, and release gates apply consistently across future endpoints.
- Broker secrets and persistence stay server-side.
- AI provider credentials, raw provider requests, raw provider responses, authorization headers, private provider URLs, stack traces, and hidden prompts stay out of browser responses and persisted audit records.
- Streaming, memory, and usage metadata remain audit-safe and do not create autonomous actions or mutation paths.
- Opportunity analysis can improve review quality without adding a hidden trading, broker, worker, deployment, SQL, or shell execution path.
- Opportunity ranking and review improve comparison and auditability without creating execution recommendations or autonomous actions.
- Portfolio intelligence gives users a higher-level advisory dashboard while preserving deterministic calculations and paper-trading-only boundaries.
- Frontend bundle splitting reduces initial delivery cost without changing business calculations, authentication, authorization, AI routing, opportunity ranking, or portfolio intelligence behavior.
- Release-candidate readiness can be evaluated with safe metadata and diagnostics before any deployment action.

Tradeoffs:

- Some infrastructure is intentionally abstract before every future asset or broker is fully implemented.
- API boundaries require more tests than direct in-process UI calls.
- Shared AI core and legacy operational modules still remain in the eager graph where existing App workflows use them; deeper route extraction is deferred.
- Runtime diagnostics add another release gate that must be maintained as new subsystems are introduced.

## Release Safety

Every release should pass CI, production build, health checks, environment verification, and paper-trading mode verification before deployment.

Phase 84 release safety additionally requires provider adapter tests, routing and fallback policy tests, deterministic response evaluation tests, credential-handling checks, and regression coverage proving Atlas AI cannot mutate trades, broker state, risk limits, releases, workers, deployments, shell commands, or SQL execution paths.

Phase 85 release safety additionally requires streaming cancellation/timeout checks, incomplete-stream persistence protection, bounded memory isolation, budget exhaustion behavior, and usage retention metadata validation.

Phase 86 release safety additionally requires opportunity input validation, stale-data warning checks, unsafe-output rejection, tenant/account/user isolation, idempotent non-destructive migration review, safe persistence verification, and regression coverage for Phases 83 through 85.

Phase 87 release safety additionally requires deterministic ranking reproducibility, component scoring bounds, explainability separation, review-state authorization, tenant-safe history filtering, UI accessibility checks, migration safety scans, sensitive-material scans, and regression coverage proving no trade, order, broker, position, risk-limit, worker, deployment, shell, SQL, or autonomous-agent path was added.

Phase 88 release safety additionally requires deterministic portfolio-health validation, malformed input rejection, concentration/diversification scoring checks, stale/missing data checks, AI insight degradation behavior, tenant-safe snapshot history, UI no-execution checks, migration safety scans, and regression coverage for Phases 84 through 87.

Phase 89 release safety additionally requires production bundle metrics, lazy-loading regression tests, accessible feature fallback/error-boundary checks, performance-budget validation, sensitive-material scans, no committed `dist`, and confirmation that no trading, broker, order, shell, SQL, deployment, autonomous-agent, embedding, or vector-search path was added.

Phase 90 release safety additionally requires `npm run release:verify`, runtime liveness/readiness checks, observability redaction tests, release metadata safety checks, diagnostics authorization checks, rollback-guidance review, migration-safety scans, generated-artifact checks, clean worktree verification, pushed-branch confirmation, and explicit advisory-only paper-trading boundary verification.
