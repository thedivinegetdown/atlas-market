# Atlas Market

Atlas Market is a React + Vite + JavaScript project prepared for local development and Netlify deployment.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm test`
- `npm run test:watch`
- `npm run netlify:dev`

## Environment

Copy `.env.example` to `.env` and adjust any local values before running the app.

## Phase 84 Atlas AI

Atlas Copilot now supports secure server-side provider routing for OpenAI, Anthropic, Google, and local/self-hosted HTTP providers while preserving the Phase 83 mock and disabled modes. Provider credentials are read only from server environment variables, never from browser input, and Atlas does not persist raw prompts, raw provider responses, authorization headers, private provider URLs, stack traces, or hidden reasoning.

Routing is server-authoritative: requests are matched against administrator-approved provider descriptors, category eligibility, model allowlists, health state, structured-output support, retry and fallback eligibility, bounded fallback depth, and configured token budgets. Client input can select only approved provider/model descriptors; it cannot provide arbitrary model ids or provider URLs. When no valid provider exists, Copilot returns an explicit degraded advisory response and deterministic Atlas workflows continue unaffected.

Responses are evaluated by a deterministic Atlas evaluator before they are recorded. The evaluator checks schema compliance, required fields, advisory-only and paper-trading-only boundaries, limitations, grounding risk, prohibited action content, HTML/script contamination, excessive certainty, confidence consistency, fallback usage, and provider-response validation. Safety failures reject the response; lower-quality but safe responses can return with warning metadata and stronger limitations.

## Phase 85 Atlas AI

Atlas Copilot now supports provider-neutral streaming events for started, chunk, completed, error, and cancelled states. Streams carry correlation and session identifiers, support abort and timeout handling, fall back to validated non-streaming responses when provider-native streaming is unavailable, and never mark incomplete streams as completed responses.

Conversation memory is compact and bounded. Recent turns are retained by tenant, account, user, and session; older turns are summarized into sanitized text with configurable retention and expiration. Atlas does not store raw provider prompts or raw provider responses, and Phase 85 intentionally avoids vector databases, embeddings, unlimited long-term memory, and autonomous agents.

Usage controls estimate tokens and cost, track authorized daily and monthly summaries, attach retention metadata, and return graceful degraded advisory responses when configured budgets are exhausted. Budget exhaustion affects only AI assistance; deterministic Atlas workflows remain available.

## Phase 86 Opportunity Analysis

Atlas opportunity analysis completes the Copilot market-opportunity workflow. Requests pass through authenticated Netlify APIs, server-side tenant/account/user scoping, deterministic input validation, candidate normalization, eligibility rules, AI-assisted interpretation through the existing Atlas AI gateway, final structured validation, and compact audit-safe persistence.

The deterministic layer owns symbols, timeframes, limits, stale-data warnings, source timestamps, baseline ranks, hard rejections, no-trade reasons, and paper-trading boundaries. AI assistance may summarize and compare eligible candidates, but it cannot fabricate market data, provide guaranteed outcomes, create unsupported price targets, or override deterministic guardrails.

Opportunity history stores only sanitized summaries, candidate fingerprints, baseline/advisory ranks, exclusions, no-trade flags, usage estimates, context fingerprints, and retention metadata. It does not store raw provider prompts, raw provider responses, authorization headers, credentials, chain-of-thought, executable instructions, or live-trading state.

## Phase 87 Opportunity Ranking and Review

Atlas opportunity review now adds deterministic ranking, compact explainability, recent-history filters, and human review metadata on top of the Phase 86 opportunity-analysis workflow. Ranking is reproducible from validated stored inputs such as scanner score, source-data freshness, liquidity, data quality, strategy compatibility, risk severity, missing data, stale-data flags, provider degradation, and evaluator warnings. Scores are bounded, confidence is clamped, unsafe or rejected opportunities are not marked actionable, and every ranked item keeps advisory-only and paper-trading-only notices.

Explainability separates observed Atlas evidence from model interpretation. Each ranked opportunity includes positive contributors, negative contributors, stale or missing data, evaluator warnings, fallback/degraded status, limitations, and version metadata without exposing prompts, raw provider payloads, hidden reasoning, private URLs, credentials, or chain-of-thought.

The review workflow supports `new`, `reviewing`, `saved`, `dismissed`, and `expired` states plus bounded optional feedback. Review updates require authenticated tenant/account/user authority, store only compact sanitized notes, preserve audit history, and never create orders, prepare trades, call brokers, start workers, or trigger autonomous execution. The UI shows ranked advisory opportunities, confidence/freshness/degraded indicators, expandable explanations, and save/dismiss controls for human review only.

## Phase 88 Portfolio Intelligence

Atlas Portfolio Intelligence aggregates existing paper positions, risk analytics, watchlist context, signals, and opportunity summaries into a unified advisory dashboard. The deterministic health engine computes diversification, concentration, sector and symbol allocation, realized and unrealized P&L summaries, volatility estimates, exposure, stale positions, missing data, confidence metadata, and risk-tier limitations without AI-generated math.

AI portfolio insights reuse the existing Atlas AI Gateway through the `portfolio_summary` category. Provider output is treated as interpretation only and is separated from observed portfolio data. Insights may describe diversification, concentration, stale holdings, watchlist overlap, repeated opportunity patterns, missing information, and possible research areas, but they do not produce price predictions, guaranteed outcomes, trade recommendations, autonomous actions, broker calls, or order instructions.

Portfolio intelligence history stores compact tenant/account/user-scoped snapshots with score, risk tier, category, symbols, limitations, and AI insight status. It excludes raw prompts, raw provider payloads, credentials, authorization headers, private URLs, stack traces, and chain-of-thought. The dashboard panel displays health, diversification, concentration, AI insight state, opportunity/watchlist summaries, risk summaries, stale-data warnings, and loading/error/degraded states without trade buttons.

## Phase 89 Performance Delivery

Atlas now defers heavyweight dashboard panels with feature-level `React.lazy` boundaries for Atlas Copilot, Opportunity Review, Portfolio Intelligence, and Release Diagnostics. The initial shell, navigation, paper-trading summaries, permissions, and deterministic dashboards stay immediately available while those feature panels load only when requested by the client runtime.

Production bundle baseline before Phase 89 was 2,000.41 kB of JavaScript across 13 chunks, with a 518.17 kB initial entry chunk and a recurring Vite chunk-size warning. After Phase 89, production output is 2,004,644 bytes of JavaScript across 14 chunks; eager JavaScript is 1,798,441 bytes, the initial entry/largest eager chunk is 504,418 bytes, and the largest deferred feature chunk is 107,134 bytes. Vite no longer reports the chunk-size warning.

The Vite/Rolldown strategy keeps stable vendor and subsystem chunks for React, analytics, strategy, risk/execution, market data, reporting, compliance, system operations, charting, and research. Phase 89 adds separate `atlas-ai-panels` and `release-diagnostics-ui` deferred feature chunks and filters modulepreload hints for those lazy panels so they are not pulled into the initial network path. Shared AI core code remains available to existing App decision workflows; the deferred panel chunks contain the expensive UI surfaces.

The `npm run performance:check` script validates build metrics after `npm run build`, including entry size, largest eager chunk, total eager JavaScript, absence of static imports for designated heavy features, and expected deferred feature chunks. The check is local, deterministic, network-free, and does not commit `dist`.

## Phase 90 Release Candidate Readiness

Atlas now has production-safe runtime liveness and readiness diagnostics for release-candidate review. Liveness checks only the application runtime and paper-trading boundary, while readiness includes required configuration, API reliability, migration compatibility, optional AI provider status, paper-trading availability, performance-budget status, and safe release metadata. Optional AI degradation reports as degraded without making deterministic Atlas workflows unavailable.

Structured observability records use bounded labels, normalized failure categories, sanitized correlation/request/tenant/account/user context, and redacted metadata. Credentials, authorization headers, raw prompts, raw provider responses, private URLs, stack traces, chain-of-thought, and tenant-sensitive content are excluded from logs, metrics, diagnostics payloads, and release metadata.

`npm run release:verify` runs release-critical gates in order: production configuration validation, focused security/release tests, full tests, lint with the 26-warning baseline, production build, performance budget, migration-safety scan, sensitive-material scan, generated-artifact check, and git-state reporting. The command is cross-platform Node, requires no network access, does not deploy, does not call live providers, and does not mutate production data.

Release diagnostics remain lazily loaded and now display authorized runtime health, readiness, release metadata, performance-budget status, migration compatibility, and release-verification state. Rollback guidance is operational only: restore a prior frontend deployment, disable or forward-fix a failing function, correct configuration descriptors, hold migrations for forward-compatible remediation, degrade AI assistance during provider outages, or block release on performance regression. Atlas does not execute rollback, deploy, downgrade migrations, clear data, or call brokers.

## Safety Boundaries

Atlas AI remains read-only and advisory-only. It must not place or modify trades, create live orders, change risk limits, approve releases, publish documents, trigger workers, deploy, call brokers, execute shell commands, or issue executable SQL. User text, Atlas records, prior AI output, and provider output are treated as untrusted.

## Testing Strategy

Phase 84 validation is focused on adapter contract behavior, missing credential handling, sanitized errors, timeouts, bounded retry/fallback, category routing, model allowlists, arbitrary provider/model rejection, structured capability matching, degraded no-provider behavior, deterministic evaluation scoring, schema and safety rejection, confidence clamping, tenant/user authorization, and confirmation that no AI mutation path exists.

Phase 85 validation adds ordered streaming chunks, cancellation, timeout, fallback, final validation, incomplete stream persistence protection, memory summarization, retention, reset, tenant/user isolation, cost estimation, budgets, and authorized usage summaries.

Phase 86 validation adds opportunity request validation, symbol/timeframe/limit rejection, stale-data warnings, confidence clamping, unsafe provider-output rejection, tenant/account/user authorization, API error safety, opportunity-history migration safety, reliability route registration, and regression coverage for Phases 83, 84, and 85.

Phase 87 validation adds deterministic ranking reproducibility, tier boundaries, component scoring, explainability separation, review-state authorization, tenant-safe history filtering, migration safety, UI rendering, and regression checks proving no order, broker, live-execution, autonomous-agent, SQL, shell, or deployment path was added.

Phase 88 validation adds deterministic portfolio-health math, malformed input rejection, concentration/diversification scoring, stale and missing data detection, AI insight degradation, tenant-safe portfolio-history filters, UI accessibility/rendering, migration safety, and regression coverage for the AI/opportunity foundation.

Phase 89 validation adds lazy feature import checks, accessible loading/failure fallback coverage, direct lazy module resolution, performance-budget parser and failure tests, App shell regression coverage, and production-build budget validation with `npm run performance:check`.

Phase 90 validation adds liveness/readiness status checks, AI-degraded readiness behavior, safe failure categories, observability redaction, release-verification stage ordering and fail-fast behavior, lint-warning baseline checks, metadata safety, runtime health endpoint safety, diagnostics UI authorization states, and regression coverage for Phase 89 performance splitting.

## Development History

Phase 83 established Atlas Copilot as a bounded, persisted, mock-first advisory layer. Phase 84 adds real-provider adapter seams, server-controlled routing/fallback, and deterministic response evaluation without changing the paper-trading-only architecture. Implementation assistance from Codex was used to draft and validate this phase; product direction, safety requirements, and acceptance criteria remain the project owner’s contribution.

Interview-ready summary: Atlas Copilot is designed as a safe AI adapter layer, not an autonomous trading agent. Real providers sit behind server-only descriptors and secret handling, routing is deterministic and auditable, and every model response is treated as untrusted until it passes schema and safety evaluation.

Phase 85 development note: streaming UX, compact conversation memory, and usage/cost controls were added without changing the advisory-only paper-trading boundary. Interview-ready addition: streaming is finalized only after validation, memory is compact and tenant-scoped, usage is budget-aware, and every budget failure degrades AI assistance without affecting deterministic Atlas workflows.

Phase 86 development note: opportunity analysis was completed as an advisory workflow over existing Atlas market and paper-trading context. Interview-ready addition: deterministic preprocessing decides what data is eligible, AI only explains bounded candidates, stale data is surfaced explicitly, and no output creates a trade, order, broker call, automation, shell command, SQL execution, or live-system mutation. Codex assisted with implementation and tests; product requirements, safety boundaries, and acceptance criteria remain the project owner's contribution.

Phase 87 development note: opportunity ranking and review make the analysis workflow easier to compare and audit. Interview-ready addition: Atlas ranks opportunities with deterministic component math, explains observed evidence separately from interpretation, and lets humans save or dismiss records as review metadata only. Codex assisted with implementation and tests; product requirements, safety boundaries, and acceptance criteria remain the project owner's contribution.

Phase 88 development note: portfolio intelligence elevates the Copilot from single-opportunity review to portfolio-wide health review. Interview-ready addition: Atlas computes portfolio scores deterministically, uses AI only for bounded interpretation, stores compact tenant-scoped snapshots, and keeps every output advisory-only and paper-trading-only. This phase completes the roadmap step from opportunity review into portfolio-level intelligence; autonomous trading, broker connectivity, vector search, embeddings, and live execution remain deferred. Codex assisted with implementation and tests; product requirements, safety boundaries, and acceptance criteria remain the project owner's contribution.

Phase 89 development note: frontend delivery was hardened without changing trading, AI, opportunity, or portfolio behavior. Interview-ready addition: Atlas measures production bundles, defers heavyweight advisory panels behind safe boundaries, keeps shared vendor chunks cacheable, and enforces an eager-load performance budget in CI-friendly tooling. Deferred optimizations include deeper route-level extraction of the remaining monolithic App shell and finer subsystem ownership for legacy operational panels. Codex assisted with implementation and validation; product requirements, safety boundaries, and acceptance criteria remain the project owner's contribution.

Phase 90 development note: release-candidate readiness now has deterministic liveness/readiness, redacted observability records, safe runtime diagnostics, and a single release verification command. Interview-ready addition: Atlas can prove release readiness without deploying, touching production data, calling providers, or expanding past advisory-only paper trading. Rollback readiness is documented as human-controlled restoration or forward-fix guidance, never as destructive automation. Codex assisted with implementation and validation; product requirements, safety boundaries, and acceptance criteria remain the project owner's contribution.

## Tooling

- Vite for development and production builds
- Vitest for JavaScript tests
- Netlify CLI for local Netlify development
- PostgreSQL client support via `pg`
