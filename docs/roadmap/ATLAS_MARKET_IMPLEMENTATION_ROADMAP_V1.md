# Atlas Market Implementation Roadmap v1.0

Status: Proposed execution baseline
Effective date: 2026-07-27
Planning horizon: post-v1.0.0 incremental hardening and evidence

## 1. Roadmap intent

This roadmap converts repository-supported remaining work into small execution phases. It does not authorize implementation by itself. Each phase requires a focused execution order under the [Engineering Process](../process/ATLAS_MARKET_ENGINEERING_PROCESS.md), and sequencing may change only through architecture review.

Live brokerage execution, autonomous trading, financial advice, destructive recovery controls, uncontrolled provider/model selection, and unapproved architecture redesign remain out of scope for every program.

## 2. Recommended execution sequence

```text
P1 Architecture evidence
  -> P2 Endpoint inventory
  -> P3 Credential boundary
  -> P4 Persistence operations
  -> P5 Critical journey telemetry
  -> P6 Alert ownership
  -> P7 Provider runbooks
  -> P8 Degraded-mode verification
  -> P9 CI/release alignment
  -> P10 Production smoke automation
  -> P11 Workspace evidence
  -> P12 Documentation/release review
```

Phases are deliberately narrow. A phase may be split further by its execution order but must not be merged into a giant implementation scope.

## Program A — Architecture and capability governance

Goal: make the implemented, integrated, configured, and production-verified states of the large repository explicit.

### Epic A1 — Runtime capability evidence

#### Phase P1 — Capability/runtime matrix

- **Goal:** establish a reviewable inventory distinguishing modeled engines, tested APIs, UI-integrated capabilities, persistence-backed capabilities, and production-verified integrations.
- **Dependencies:** architecture v1.0 and ADR index approved.
- **Implementation scope:** inventory `src/`, `lib/`, `netlify/functions/`, tests, and operator docs; assign capability owner/status/evidence; document unknowns.
- **Exclusions:** application code, endpoint changes, claiming external configuration without evidence.
- **Acceptance criteria:** every top-level subsystem has an owner/status; each “production” claim cites repository or operator evidence; paper/advisory boundaries are visible.
- **Validation requirements:** path/link check; sample at least one UI, API, engine, database, provider, and release capability against source; architecture review.
- **Definition of done:** matrix is approved, versioned, linked from architecture, and unresolved deployment facts have owners.
- **Architecture references:** Enterprise Architecture §§2, 5, 20; ADR-0005, ADR-0006, ADR-0010.

#### Phase P2 — API and cross-cutting control inventory

- **Goal:** prove which shared validation, authentication, tenant, rate-limit, logging, and error controls apply to each Netlify Function.
- **Dependencies:** P1.
- **Implementation scope:** generate or maintain endpoint/control inventory; classify public/protected/admin endpoints and allowed methods; identify exceptions.
- **Exclusions:** endpoint consolidation, API behavior changes, auth-provider changes.
- **Acceptance criteria:** every function entry point is classified; every exception has rationale and owner; high-risk gaps become separate phases.
- **Validation requirements:** compare inventory with `netlify/functions/*.js`; shared-handler conformance checks; documentation link validation.
- **Definition of done:** no unclassified function remains and architecture review accepts the control map.
- **Architecture references:** Enterprise Architecture §§5, 8, 12–14; ADR-0005, ADR-0006, ADR-0011.

## Program B — Security and persistence hardening

Goal: formalize confidential configuration and prove durable, tenant-safe PostgreSQL operations without changing product behavior.

### Epic B1 — Provider credential boundary

#### Phase P3 — Market-provider credential classification

- **Goal:** resolve whether Finnhub and Twelve Data credentials are public constrained client keys or confidential server credentials.
- **Dependencies:** P1; provider account constraints available to the reviewer.
- **Implementation scope:** threat analysis of `.env.example` and import graphs; document key classification, allowed origins/quotas, rotation owner, and approved browser/server location; propose a later migration phase if needed.
- **Exclusions:** credential values, provider migration, runtime behavior changes.
- **Acceptance criteria:** each key has an approved classification; no confidential value is authorized for `VITE_*`; remediation is explicitly scoped if exposure is unacceptable.
- **Validation requirements:** static import/config review, sensitive-material scan, provider-console evidence recorded outside source where necessary.
- **Definition of done:** security and architecture reviewers approve the boundary and ADR-0011 is confirmed or superseded.
- **Architecture references:** Enterprise Architecture §§6, 9, 14, 20; ADR-0007, ADR-0011.

### Epic B2 — Managed PostgreSQL operations

#### Phase P4 — Connection, migration, backup, and recovery evidence

- **Goal:** document and validate the operational contract for the configured PostgreSQL service, including a Supabase-hosted PostgreSQL deployment if that is the selected external service.
- **Dependencies:** P1; production/staging database ownership identified; no secrets stored in docs.
- **Implementation scope:** connection pooling/capacity plan, migration execution owner, compatibility policy, backup/restore runbook, recovery objectives, retention, tenant-query review, and staged rehearsal evidence.
- **Exclusions:** schema redesign, destructive migration, data migration, vendor commitment without approval.
- **Acceptance criteria:** connection limits and pooling are known; migrations have a safe operator path; backup restoration is rehearsable; Supabase-specific claims appear only if externally verified.
- **Validation requirements:** non-destructive staging checks, migration safety scan, restore tabletop or authorized rehearsal, tenant-scope query sampling.
- **Definition of done:** database owner accepts the runbook and remaining operational gaps have bounded roadmap phases.
- **Architecture references:** Enterprise Architecture §§6, 12, 19–20; ADR-0006.

## Program C — Observability and provider resilience

Goal: make critical paper-trading journeys and external degradation diagnosable without logging sensitive content.

### Epic C1 — Service indicators and correlation

#### Phase P5 — Critical-journey telemetry contract

- **Goal:** define request/event correlation and measurable indicators for workspace load, market read, paper-order submission, risk rejection, and advisory AI response.
- **Dependencies:** P2 and credential classification from P3.
- **Implementation scope:** telemetry schema, redaction rules, correlation propagation, success/failure/latency indicators, retention classification, dashboard specification.
- **Exclusions:** raw prompts/responses, credentials, hidden reasoning, tenant payload dumps, vendor purchase.
- **Acceptance criteria:** five journeys have named indicators and owners; event fields are safe and versioned; paper versus live semantics cannot be confused.
- **Validation requirements:** schema tests, redaction tests, representative log review, privacy/security review.
- **Definition of done:** telemetry contract and dashboard/collection decision are approved; implementation, if any, remains one focused order.
- **Architecture references:** Enterprise Architecture §§6, 11, 14–15; ADR-0010, ADR-0011, ADR-0014.

#### Phase P6 — Alerts, SLOs, and incident ownership

- **Goal:** turn critical-journey indicators into actionable operational thresholds and ownership.
- **Dependencies:** P5 and an approved telemetry collection destination.
- **Implementation scope:** initial SLOs, alert thresholds, severity, routing owner, runbook link, maintenance/suppression rules, review cadence.
- **Exclusions:** automated rollback, destructive recovery, customer SLA promises.
- **Acceptance criteria:** every critical alert has an owner and response; alert data excludes sensitive content; thresholds distinguish optional-provider degradation from core paper-workflow failure.
- **Validation requirements:** synthetic/tabletop alert exercise and false-positive review.
- **Definition of done:** operations accepts the SLO/alert catalog and records test evidence.
- **Architecture references:** Enterprise Architecture §§15, 17–20; ADR-0014.

### Epic C2 — Market provider operations

#### Phase P7 — Provider health and failover runbook

- **Goal:** document operator-visible provider selection, freshness, quota, failover, mock, and degraded-state semantics.
- **Dependencies:** P3 and P5.
- **Implementation scope:** provider contract/version inventory, failure taxonomy, provenance requirements, staleness thresholds, failover decision table, escalation and recovery runbook.
- **Exclusions:** new provider, algorithm redesign, concealed fallback.
- **Acceptance criteria:** operators can distinguish primary, fallback, stale, mock, and unavailable data; no fallback is described as current without freshness evidence.
- **Validation requirements:** source-to-runbook trace, contract test review, tabletop provider outage.
- **Definition of done:** runbook is linked from System Health/operator docs and accepted by architecture review.
- **Architecture references:** Enterprise Architecture §§6, 9, 15, 20; ADR-0007, ADR-0008.

#### Phase P8 — Provider degraded-mode verification

- **Goal:** verify existing market and AI optional-provider failures leave deterministic paper workflows usable and clearly degraded.
- **Dependencies:** P7; AI safety contract confirmed.
- **Implementation scope:** focused automated and manual scenarios for timeout, malformed payload, quota failure, stale data, missing key, fallback exhaustion, and AI unavailability.
- **Exclusions:** provider replacement, AI behavior expansion, live execution.
- **Acceptance criteria:** failures are safe, labeled, observable, and do not bypass validation or risk controls; deterministic workflows remain available where designed.
- **Validation requirements:** focused provider/AI tests plus workspace acceptance checks and log-redaction review.
- **Definition of done:** scenario evidence passes and any failure becomes a separate defect order.
- **Architecture references:** Enterprise Architecture §§9–11, 13–15; ADR-0008, ADR-0010, ADR-0011.

## Program D — Release assurance

Goal: make the main-branch gate and production verification repeatable and consistent with the existing release model.

### Epic D1 — Gate convergence

#### Phase P9 — CI and release-verification alignment

- **Goal:** decide and document which `release:verify` stages must run in CI and which remain operator gates.
- **Dependencies:** P1 and an observed duration/stability baseline.
- **Implementation scope:** compare `.github/workflows/ci.yml` with `scripts/release-verify.mjs`; assign each check to PR, main, or release review; document warning baseline ownership.
- **Exclusions:** unrelated workflow redesign, deployment automation, dependency upgrades.
- **Acceptance criteria:** no release-critical check lacks an owner/gate; CI time and flake tradeoffs are recorded; the lint-warning baseline cannot drift silently.
- **Validation requirements:** workflow syntax review, representative CI run, local release verification, architecture review.
- **Definition of done:** gate matrix is approved and implemented only through a separately authorized focused order.
- **Architecture references:** Enterprise Architecture §§16–18, 20; ADR-0014.

### Epic D2 — Production journey evidence

#### Phase P10 — Read-only production smoke automation

- **Goal:** automate safe verification of production availability, workspace route refresh, function health, and browser-console errors.
- **Dependencies:** P5 and P9; production test target/authorization approved.
- **Implementation scope:** read-only smoke script for root and workspace routes, critical health responses, lazy chunks, console/network failure capture, and evidence output.
- **Exclusions:** paper-order mutation unless separately approved, deployment, rollback, tags/releases, destructive controls.
- **Acceptance criteria:** all documented routes return/render correctly; failures are actionable; script cannot submit orders or mutate production data.
- **Validation requirements:** local/staging execution then authorized production execution; inspect generated evidence for secrets.
- **Definition of done:** operator guide links the repeatable smoke command and a successful evidence record.
- **Architecture references:** Enterprise Architecture §§7, 15, 17–18; ADR-0002, ADR-0003, ADR-0015.

## Program E — Product evidence and experience consistency

Goal: close documented presentation/evidence gaps without changing domain behavior.

### Epic E1 — Workspace review

#### Phase P11 — Workspace summaries, responsive polish, and accessibility audit

- **Goal:** identify small presentation-only gaps across all fourteen workspaces and prioritize them without combining them into one implementation phase.
- **Dependencies:** P1 and P10 baseline screenshots/evidence.
- **Implementation scope:** audit information hierarchy, empty/loading/error/degraded states, narrow layouts, forms/tables, keyboard flow, disclosures, and screenshots; produce per-workspace findings.
- **Exclusions:** domain calculations, APIs, schema, AI behavior, trading logic, shell redesign.
- **Acceptance criteria:** each workspace has findings or an explicit pass; each proposed change has public acceptance criteria; issues are split into independently executable slices.
- **Validation requirements:** route-by-route desktop/narrow review, automated accessibility checks where available, existing responsive tests.
- **Definition of done:** approved prioritized backlog and screenshot plan exist; no giant cross-workspace implementation order is created.
- **Architecture references:** Enterprise Architecture §§7, 10–11, 16; ADR-0002 through ADR-0004, ADR-0009, ADR-0010.

### Epic E2 — Documentation and release closeout

#### Phase P12 — Architecture/release evidence review

- **Goal:** reconcile architecture, roadmap, ADRs, operator guides, README, release evidence, and actual deployment after Programs A–E.
- **Dependencies:** P1–P11 or explicitly documented deferrals.
- **Implementation scope:** documentation-only truth review, link/path validation, capability status updates, risk disposition, next roadmap version recommendation.
- **Exclusions:** application changes, new release/tag, claims unsupported by evidence.
- **Acceptance criteria:** documents agree on version, boundaries, deployment, and capability status; unresolved questions have owners; superseded ADRs are marked.
- **Validation requirements:** documentation link/path checker, repository validation, documentation-only diff, architecture review.
- **Definition of done:** architecture review accepts the baseline and authorizes either roadmap v1.1 or closure.
- **Architecture references:** all Enterprise Architecture sections and ADRs; Engineering Process.

## 3. Program summary

| Program | Outcome | Phases |
| --- | --- | --- |
| A. Architecture and capability governance | Truthful runtime/control inventory | P1–P2 |
| B. Security and persistence hardening | Approved credential and managed-Postgres operations boundaries | P3–P4 |
| C. Observability and provider resilience | Diagnosable journeys and safe provider degradation | P5–P8 |
| D. Release assurance | Consistent gates and read-only production smoke evidence | P9–P10 |
| E. Product evidence and experience consistency | Small presentation backlog and documentation closeout | P11–P12 |

## 4. Roadmap governance

Every phase must be architecture-reviewed before execution and after its single commit/push. A phase cannot silently broaden a trust boundary. New dependencies, public behavior, persistence/schema, provider routing, risk calculations, trading behavior, AI behavior, or deployment behavior require explicit acceptance criteria and, when material, a new or superseding ADR.
