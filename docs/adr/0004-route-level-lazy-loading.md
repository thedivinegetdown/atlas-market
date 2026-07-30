# ADR 0004: Route-Level Lazy Loading and Bundle Boundaries

## Status

Accepted (retrospective)

## Context

Atlas has many workspaces and heavyweight analytics, AI, diagnostics, market, and governance modules. Eager loading would make the initial workspace unnecessarily large.

## Decision

Load each workspace with `React.lazy`, provide accessible suspense/error fallbacks in the shell, and use explicit Vite chunk groups plus a performance-budget check. Defer selected heavyweight feature panels within routes.

## Consequences

Initial delivery is smaller and failures can be isolated. Chunk naming, preload decisions, fallback UX, and budget thresholds require regression tests.

## Related files or systems

`src/AppRoutes.jsx`, `src/components/WorkspaceLayout.jsx`, `src/components/LazyFeatureBoundary.jsx`, `vite.config.js`, `scripts/check-build-performance.mjs`, `tests/phase89-performance-bundle-splitting.test.js`.
