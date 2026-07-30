# ADR 0002: React and Vite Frontend Architecture

## Status

Accepted (retrospective)

## Context

Atlas requires an interactive, component-oriented workspace that builds to static assets and can share JavaScript domain modules.

## Decision

Use React 19 for UI composition and Vite for local development, production builds, React transformation, and bundle splitting. Keep `src/main.jsx` and `src/App.jsx` as lightweight bootstrap code.

## Consequences

The UI has a mature component/test ecosystem and deploys as static assets. Browser bundles must not import server secrets, and Vite configuration and performance budgets become release-critical.

## Related files or systems

`package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/test/setup.js`.
