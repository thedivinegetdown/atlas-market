# ADR 0006: Netlify Functions Backend Boundary

## Status

Accepted (retrospective)

## Context

The browser needs server-side validation, secrets, provider access, authorization, persistence, and paper-workflow orchestration without a continuously managed application server.

## Decision

Expose server behavior as individual Netlify Functions under `netlify/functions/`. Browser code calls `/.netlify/functions` through the workspace API client. Functions use shared API, auth, and persistence wrappers and delegate domain behavior to `lib/` modules.

## Consequences

Endpoints deploy independently and fit the hosting model. Cross-cutting controls must be kept consistent across many entry points; cold starts, connection lifecycle, and lack of a long-running process constrain workers and streaming.

## Related files or systems

`netlify/functions/`, `netlify/functions/_shared/`, `src/api/workspaceApiClient.js`, `netlify.toml`, `lib/system/apiReliabilityEngine.js`.
