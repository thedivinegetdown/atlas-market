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

## Safety Boundaries

Atlas AI remains read-only and advisory-only. It must not place or modify trades, create live orders, change risk limits, approve releases, publish documents, trigger workers, deploy, call brokers, execute shell commands, or issue executable SQL. User text, Atlas records, prior AI output, and provider output are treated as untrusted.

## Testing Strategy

Phase 84 validation is focused on adapter contract behavior, missing credential handling, sanitized errors, timeouts, bounded retry/fallback, category routing, model allowlists, arbitrary provider/model rejection, structured capability matching, degraded no-provider behavior, deterministic evaluation scoring, schema and safety rejection, confidence clamping, tenant/user authorization, and confirmation that no AI mutation path exists.

Phase 85 validation adds ordered streaming chunks, cancellation, timeout, fallback, final validation, incomplete stream persistence protection, memory summarization, retention, reset, tenant/user isolation, cost estimation, budgets, and authorized usage summaries.

## Development History

Phase 83 established Atlas Copilot as a bounded, persisted, mock-first advisory layer. Phase 84 adds real-provider adapter seams, server-controlled routing/fallback, and deterministic response evaluation without changing the paper-trading-only architecture. Implementation assistance from Codex was used to draft and validate this phase; product direction, safety requirements, and acceptance criteria remain the project owner’s contribution.

Interview-ready summary: Atlas Copilot is designed as a safe AI adapter layer, not an autonomous trading agent. Real providers sit behind server-only descriptors and secret handling, routing is deterministic and auditable, and every model response is treated as untrusted until it passes schema and safety evaluation.

Phase 85 development note: streaming UX, compact conversation memory, and usage/cost controls were added without changing the advisory-only paper-trading boundary. Interview-ready addition: streaming is finalized only after validation, memory is compact and tenant-scoped, usage is budget-aware, and every budget failure degrades AI assistance without affecting deterministic Atlas workflows.

## Tooling

- Vite for development and production builds
- Vitest for JavaScript tests
- Netlify CLI for local Netlify development
- PostgreSQL client support via `pg`
