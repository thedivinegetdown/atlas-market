# ADR 0015: Netlify SPA Deployment and Route Fallback

## Status

Accepted (retrospective)

## Context

Atlas uses client-side workspace routes and serverless APIs. Direct navigation to a workspace must load the SPA rather than return a hosting 404.

## Decision

Build with `npm run build`, publish `dist`, package `netlify/functions`, and configure Netlify to rewrite all unmatched paths to `/index.html` with status 200. The React router then resolves the workspace. Develop the integrated stack with `netlify dev` where function behavior is required.

## Consequences

Workspace URLs support refresh and static hosting remains simple. Function routing must take precedence as Netlify provides it, unknown client routes redirect to Dashboard, and production linkage/environment remain external operational configuration.

## Related files or systems

`netlify.toml`, `package.json`, `src/AppRoutes.jsx`, `dist` (generated and ignored), `netlify/functions/`, `.github/workflows/ci.yml`.
