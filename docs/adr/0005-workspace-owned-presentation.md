# ADR 0005: Workspace-Owned Presentation Modules

## Status

Accepted (retrospective)

## Context

A single application component previously risked owning navigation, data orchestration, and every presentation surface.

## Decision

Each route owns its entry, workspace component, and presentation sections under `src/workspaces/<Workspace>/`. Shared shell and reusable panels stay under `src/components/`; hooks, APIs, and deterministic engines retain behavior outside presentation modules.

## Consequences

Workspace changes have clearer ownership and smaller review scope. Shared behavior must not be duplicated into route modules, and cross-workspace UI changes still need coordinated acceptance criteria.

## Related files or systems

`src/workspaces/`, `src/components/workspace/WorkspacePage.jsx`, `src/components/panels.jsx`, `src/hooks/`.
