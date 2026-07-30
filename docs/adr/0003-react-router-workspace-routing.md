# ADR 0003: React Router Workspace Routing

## Status

Accepted (retrospective)

## Context

The product replaced a long dashboard with addressable workspaces that require browser navigation and direct refresh.

## Decision

Use React Router with a persistent layout route. `/` and `/dashboard` render Dashboard; fourteen named workspace routes render inside `WorkspaceLayout`; unknown paths redirect to `/`.

## Consequences

Routes are linkable and independently testable. Hosting must provide SPA fallback, and route definitions and navigation metadata must remain synchronized.

## Related files or systems

`src/App.jsx`, `src/AppRoutes.jsx`, `src/components/WorkspaceLayout.jsx`, `src/workspaces/workspaceRoutes.js`, `netlify.toml`.
