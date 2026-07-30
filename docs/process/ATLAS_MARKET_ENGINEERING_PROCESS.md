# Atlas Market Engineering Process

Status: Required for future engineering work
Effective date: 2026-07-27

## Purpose

Atlas Market evolves through architecture-first, evidence-based increments. This process preserves paper-trading and advisory-only boundaries while keeping implementation scopes small enough to review, validate, and reverse safely.

```text
Architecture
    ↓
Roadmap
    ↓
Execution Order
    ↓
Implementation
    ↓
One Validation Cycle
    ↓
One Commit
    ↓
One Push
    ↓
Architecture Review
    ↓
Next Sprint
```

## Required artifacts

- **Architecture:** the current [Enterprise Architecture](../architecture/ATLAS_MARKET_ENTERPRISE_ARCHITECTURE_V1.md) and applicable [ADRs](../adr/README.md).
- **Roadmap:** an approved program, epic, and phase in the [Implementation Roadmap](../roadmap/ATLAS_MARKET_IMPLEMENTATION_ROADMAP_V1.md).
- **Execution order:** one implementation-ready instruction set for one phase or a smaller slice.
- **Validation evidence:** command results and any required manual evidence.
- **Commit and push:** one focused commit and one push for the execution order.
- **Architecture review:** explicit confirmation of contract fit, new risks, and documentation impact before another sprint begins.

## Stage gates

### 1. Architecture

Confirm the current subsystem owner, trust boundaries, invariants, data flow, and applicable ADRs. Implementation must not redesign architecture opportunistically. If the work requires a material new boundary, dependency, provider, persistence model, public contract, or safety-policy change, stop and approve an ADR first.

### 2. Roadmap

The work must map to a named program, epic, and phase. New work is added to the roadmap before execution unless it is an urgent defect that restores already documented behavior. A roadmap entry states dependencies, scope, exclusions, acceptance criteria, validation, definition of done, and architecture references.

### 3. Execution order

An execution order must:

- reference the architecture sections, ADRs, and roadmap phase it implements;
- define one focused outcome and the exact allowed surface;
- identify files or subsystems likely to change;
- repeat relevant paper-only, advisory-only, security, and tenant invariants;
- provide observable acceptance criteria and a bounded validation plan;
- state exclusions and stop conditions;
- avoid bundling unrelated cleanup, redesign, or “implement everything” work.

Giant implementation prompts are prohibited. If a scope cannot be validated and reviewed as one coherent change, split it before implementation.

### 4. Implementation

Implement only the execution order. Preserve working architecture and public behavior outside its acceptance criteria. Do not add dependencies, change APIs, alter schema, adjust trading/risk calculations, or change AI/provider behavior unless explicitly in scope and architecturally approved. Update tests and documentation within the same focused scope.

### 5. One validation cycle

A validation cycle is one planned sequence, not necessarily one shell command. Run the smallest focused checks first, then the agreed repository gate once. The normal release-capable cycle is:

1. focused tests for the changed contract;
2. full test suite when required by risk;
3. lint;
4. production build;
5. performance and release verification where applicable;
6. manual acceptance checks identified by the phase;
7. `git diff --check` and scope review.

If validation fails, the execution order remains open. Diagnose and correct only the in-scope cause, then run one replacement validation cycle. Do not commit known failures or hide new warnings by changing baselines without approval.

### 6. One commit

After the validation cycle passes, create one cohesive commit whose message identifies the phase and outcome. The commit contains no unrelated user changes, generated `dist`, local Netlify state, secrets, or undocumented dependency updates.

### 7. One push

Push the reviewed commit once to the intended branch. Do not add tags, releases, deployment actions, or unrelated remote mutations unless the execution order explicitly authorizes them.

### 8. Architecture review

Before the next sprint, review:

- acceptance criteria and validation evidence;
- subsystem ownership and dependency direction;
- public API, event, persistence, provider, and UI contract changes;
- trust-boundary and threat-model impact;
- paper-trading, risk-guardrail, and advisory-AI invariants;
- operational, observability, deployment, and rollback impact;
- new architectural debt, unresolved questions, and documentation/ADR updates.

The review either accepts the increment, requests a bounded correction, or requires an ADR/roadmap revision. Only acceptance opens the next sprint.

## Non-negotiable rules

1. No giant implementation prompts.
2. No architecture redesign during implementation.
3. Every execution order references architecture, roadmap, and applicable ADRs.
4. One focused scope per execution order.
5. One planned validation cycle per completed scope; failures trigger correction and a replacement cycle.
6. One commit per execution order.
7. One push per execution order.
8. Architecture review occurs before the next sprint.
9. No dependency is added or upgraded without documentation of purpose, owner, security/license impact, alternatives, and approval.
10. No public behavior or public contract changes without acceptance criteria and validation evidence.
11. No changes to paper-trading-only execution, AI advisory-only behavior, live-broker exclusion, or deterministic risk guardrails without an approved ADR.
12. No secrets, credentials, raw provider payloads, hidden AI reasoning, or tenant-sensitive diagnostics in commits or release evidence.
13. Existing user changes remain untouched unless explicitly included in scope.

## Exception handling

Urgent production defects may compress review timing but may not bypass paper/advisory boundaries, secret handling, validation, or post-change architecture review. The execution order must record why emergency handling was used and what follow-up evidence remains.

## Completion record

Each completed execution order reports: roadmap phase, architecture/ADR references, files changed, acceptance evidence, commands and outcomes, commit identifier, push target, deployment status if authorized, risks discovered, documentation changes, and architecture-review result.
