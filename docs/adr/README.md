# Atlas Market Architectural Decision Records

This index records major decisions already represented in the repository. “Retrospective” means the ADR formalizes an existing implementation rather than proposing new behavior. The records are subordinate to the current [Enterprise Architecture](../architecture/ATLAS_MARKET_ENTERPRISE_ARCHITECTURE_V1.md); a later decision must explicitly supersede an earlier one.

| ADR | Title | Status | Decision summary | Related systems |
| --- | --- | --- | --- | --- |
| [0001](0001-trading-os-architecture.md) | Trading OS Architecture | Accepted | Asset-agnostic, API-first modular platform with paper, AI, release, and safety boundaries | `src/`, `lib/`, Functions, persistence, release system |
| [0002](0002-react-vite-frontend.md) | React and Vite Frontend Architecture | Accepted (retrospective) | React UI compiled and split by Vite | `src/main.jsx`, `src/App.jsx`, `vite.config.js` |
| [0003](0003-react-router-workspace-routing.md) | React Router Workspace Routing | Accepted (retrospective) | Addressable workspaces inside a persistent shell | `src/AppRoutes.jsx`, `WorkspaceLayout`, route metadata |
| [0004](0004-route-level-lazy-loading.md) | Route-Level Lazy Loading and Bundle Boundaries | Accepted (retrospective) | Lazy routes/features with explicit chunk and budget controls | routes, lazy boundary, Vite, performance script |
| [0005](0005-workspace-owned-presentation.md) | Workspace-Owned Presentation Modules | Accepted (retrospective) | Workspaces own presentation; shared runtime stays reusable | `src/workspaces/`, `src/components/`, hooks |
| [0006](0006-netlify-functions-backend-boundary.md) | Netlify Functions Backend Boundary | Accepted (retrospective) | Server-side APIs and orchestration use thin serverless functions | Functions, shared handlers, API client |
| [0007](0007-postgresql-supabase-compatible-persistence.md) | PostgreSQL Persistence and Supabase-Compatible Boundary | PostgreSQL accepted; Supabase unverified | Generic server-side `pg` boundary; no Supabase SDK dependency | `lib/db/`, repositories, `DATABASE_URL` |
| [0008](0008-multi-provider-market-data.md) | Multi-Provider Market Data Architecture | Accepted (retrospective) | Provider contracts, registry, adapters, and normalization | Finnhub, Twelve Data, mock, market engines |
| [0009](0009-provider-fallback-behavior.md) | Provider Fallback and Degraded Behavior | Accepted (retrospective) | Explicit resilience with provenance, freshness, and degraded state | failover, resilience, cache, freshness engines |
| [0010](0010-paper-trading-only-execution.md) | Paper-Trading-Only Execution | Accepted; invariant | Simulation only; no live broker or real-money route | paper broker, orders, trading, paper APIs |
| [0011](0011-advisory-only-ai-copilot.md) | Advisory-Only AI Copilot | Accepted; invariant | Human-reviewed AI with no execution authority | AI gateway, Copilot engines/functions/UI |
| [0012](0012-deterministic-risk-guardrails.md) | Deterministic Risk Guardrails | Accepted; invariant | Deterministic limits and vetoes precede simulation | risk and guardrail engines |
| [0013](0013-environment-variable-handling.md) | Environment Variable and Secret Handling | Accepted with follow-up | Names-only env contract, redaction, scans; `VITE_*` is public | env validation, logging, release verifier |
| [0014](0014-observability-and-release-verification.md) | Observability and Release Verification | Accepted (retrospective) | Structured safe events, readiness, deterministic release gate | logging, health, release scripts, CI |
| [0015](0015-netlify-spa-deployment.md) | Netlify SPA Deployment and Route Fallback | Accepted (retrospective) | Static SPA plus Functions and history fallback | `netlify.toml`, routes, CI |

## Record format and governance

Each ADR includes number, title, status, context, decision, consequences, and related files/systems. New material decisions receive the next number. Accepted records are not edited to reverse their decision; add a superseding ADR and update this index. Changes to paper execution, AI authority, live-broker exclusion, deterministic risk guardrails, persistence technology, trust boundaries, or deployment model require approval before implementation.

Roadmap work is defined in the [Implementation Roadmap](../roadmap/ATLAS_MARKET_IMPLEMENTATION_ROADMAP_V1.md) and executed through the [Engineering Process](../process/ATLAS_MARKET_ENGINEERING_PROCESS.md).
