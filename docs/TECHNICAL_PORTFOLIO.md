# Atlas Market Technical Portfolio

## Why Atlas Was Built

Atlas Market was built to explore how a professional trading workspace can combine paper-trading workflows, deterministic risk controls, market research, portfolio intelligence, and bounded AI assistance without crossing into live execution or financial advice.

The project emphasizes product architecture, safety boundaries, release verification, and production deployment discipline.

## Frontend Architecture

Atlas uses React and Vite with a permanent trading operating-system shell. The UI is organized around dedicated workspaces rather than one long dashboard. The shell owns global navigation, breadcrumbs, responsive sidebar behavior, route loading fallback, and route error handling.

Core frontend files:

- `src/App.jsx`: lightweight application bootstrap
- `src/AppRoutes.jsx`: route definitions and lazy workspace imports
- `src/components/WorkspaceLayout.jsx`: persistent shell, navigation, Suspense, error boundary
- `src/components/workspace/WorkspacePage.jsx`: shared workspace presentation primitives
- `src/workspaces/*`: workspace-owned presentation modules

## Routing And Workspace Modularization

The v1.0.0 UI uses React Router and lazy workspace routes:

```text
App.jsx
  -> AppRoutes.jsx
  -> WorkspaceLayout
  -> React.lazy workspace route
  -> workspace-owned panels and summaries
```

Inactive workspaces are not mounted through a shared runtime. This keeps the active route focused, reduces the giant-dashboard problem, and allows production chunk splitting.

The Dashboard route is available at `/dashboard`, with `/` treated as a Dashboard alias. Netlify's SPA fallback supports direct refresh for all workspace routes.

## State And Data Flow

Atlas keeps deterministic domain behavior in existing hooks, core modules, APIs, and Netlify functions. The workspace refactor did not change trading calculations, AI behavior, APIs, database schemas, event contracts, paper-trading logic, or risk calculations.

Workspace components consume existing panels and selectors where possible. Presentation modules arrange the existing surfaces into focused pages while preserving the underlying state and contracts.

## API Reliability And Provider Fallback

Provider-backed market and AI features are treated as optional or degradable where appropriate. Atlas uses server-side routing and validation for AI provider behavior, avoids exposing provider credentials to the browser, and preserves deterministic workflows when optional AI assistance is unavailable.

Market provider availability may vary by configured keys and provider health. Provider-backed surfaces should report degraded or mock states without breaking the workspace shell.

## Risk Controls

Risk functionality remains deterministic and presentation-only in the workspace refactor. Atlas surfaces risk score, guardrails, position sizing, exposure, concentration, drawdown, and open-risk context. The UI makes paper-only and advisory-only boundaries visible near trading-related workflows.

## Paper Execution Boundaries

Orders are paper-only. The Orders workspace includes simulated order entry, paper order status, accounting context, trade journal, lifecycle summaries, and explicit no-live-trading messaging.

Atlas does not:

- route broker orders
- place live trades
- connect AI output to execution
- bypass paper-trading controls
- provide real-money trading actions

## Testing Strategy

The test suite covers core domain behavior, APIs, security and accessibility hardening, release readiness, bundle splitting, route modularization, and responsive workspace behavior.

Final v1.0.0 validation:

- 181 test files
- 1,035 passing tests
- lint passing with known hook-warning baseline
- production build passing
- release verification passing
- performance budget passing

## Observability And Release Verification

`npm run release:verify` is the release gate. It validates production configuration, focused security/release tests, the full test suite, lint, production build, performance budget, migration safety, sensitive-material scanning, generated-artifact checks, and git-state reporting.

System Health and Release Diagnostics surfaces are lazy-loaded and focused on review. They provide operator visibility without adding destructive deploy, rollback, broker, or order controls.

## Security Considerations

Atlas avoids exposing secrets in the repository or browser UI. Environment variable names are documented, but values must remain private. AI provider credentials are server-side only. Observability and release metadata are designed to avoid raw prompts, raw provider payloads, authorization headers, credentials, private URLs, stack traces, hidden reasoning, and tenant-sensitive content.

The v1.0.0 repository documentation intentionally lists environment variable names only.

## Performance And Bundle Splitting

The modular workspace architecture keeps route entries small and lazy-loaded. Heavy advisory and diagnostics panels remain deferred. Production builds emit separate chunks for:

- Dashboard
- Markets
- Scanner
- Watchlist
- Portfolio
- Risk
- Orders
- Strategies
- Backtesting
- Research
- Atlas Copilot
- Reports
- System Health
- Settings

The performance budget is enforced with `npm run performance:check` and included in `npm run release:verify`.

## Deployment Process

Atlas deploys to Netlify from `main`.

Deployment shape:

- Vite builds static assets into `dist`
- Netlify publishes `dist`
- Netlify functions live under `netlify/functions`
- `netlify.toml` configures the production build and SPA fallback
- Direct route refresh is handled by `/* -> /index.html 200`

Production URL:

https://atlas-market.netlify.app

## Major Technical Decisions

- Use React Router for real workspace routes instead of CSS-hidden panels.
- Make `App.jsx` a bootstrap file rather than the workspace runtime.
- Lazy-load every workspace route with `React.lazy`.
- Keep existing business, trading, risk, AI, API, and event contracts unchanged.
- Use Netlify SPA fallback for direct route refresh.
- Preserve paper-only and advisory-only boundaries visibly in the UI.
- Keep release verification deterministic and local.

## Challenges And Solutions

Challenge: Atlas originally rendered nearly every dashboard panel into one extremely long page.

Solution: Extract a permanent shell, workspace routes, and workspace-owned modules so only the active page renders.

Challenge: Heavy panels increased the initial runtime burden.

Solution: Preserve lazy feature boundaries and add lazy workspace routes to keep chunks split.

Challenge: Responsive navigation needed to work like a real application shell.

Solution: Add desktop fixed sidebar, tablet compact sidebar, mobile menu button, Escape close behavior, focus return, and active route accessibility.

Challenge: Production smoke testing exposed horizontal shell overflow.

Solution: Add scoped form layout CSS, shell overflow guards, and narrow-copy wrapping without changing business behavior.

## AI Assistance Disclosure

User-owned work:

- product vision
- feature requirements
- architecture direction
- validation decisions
- testing and release decisions
- debugging approval
- deployment ownership

AI-assisted work:

- code generation
- refactor proposals
- test scaffolding
- documentation drafting
- debugging suggestions

This disclosure is included so the portfolio accurately represents both human ownership and AI-assisted implementation support.
