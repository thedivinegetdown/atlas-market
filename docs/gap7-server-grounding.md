# Gap 7 — server-owned Copilot grounding foundation

Base: `285f130d916a2a0b7f02ca4b411003d47952f17b`.
Scope: Copilot chat and its UI/health metadata, read-only canonical evidence projection, frozen provider-independent evaluation. No external model configuration, purchase, push or deployment.

## Proven original boundary

At the base commit, `AtlasCopilotPanel` called `createAtlasAiGateway().stream()` in the browser with `contextSources` and caller conversation history. The separate authenticated `atlas-ai-chat` endpoint spread the entire request body into the gateway. `buildAtlasAiContext` accepted these sources and caller categories. Defaults were `mock` / `atlas-mock-advisory-v1`; the mock supplied confidence `0.72` without empirical evidence. `validateAtlasAiStructuredResponse` sanitized/clamped structure; `evaluateAtlasAiResponse` checked safety patterns and warnings, not equivalence of each claim to canonical facts. The panel also displayed fixed mock/health metadata and an initial numeric confidence.

## Repaired path

`CopilotSections` / `AtlasCopilotPanel` → `workspaceApiClient.askAtlasCopilot` → bearer + CSRF + organization membership + role-checked `atlas-ai-chat` → `loadAtlasGrounding` → canonical tenant/user/account scoped reads → `buildDecisionIntelligence` and canonical outcome/quality calculations → frozen, SHA-256 identified evidence envelope → server-selected reference-contract adapter → strict exact-key/reference validation → server-rendered facts and fixed, explicitly labeled model inference templates → React text rendering.

The body may select the authenticated organization/account and request category and supply a question/session identifier. It cannot supply facts, conversation memory, user identity, context categories, evidence, provider/model identity, URLs, configuration, or authority. Organization membership is checked; repository queries bind organization, workspace, account and authenticated user. Account identifiers do not grant access to another user's account. The existing client uses the established local organization/paper account convention.

The streaming compatibility request buffers the result and returns only validated completion/degraded data. No unchecked model chunks enter the rendered output. Cancel cancels display; it does not claim to cancel an already received server request.

## Field classification and provenance

Classification applies recursively to each fact value and its source/status/reason envelope. Null material leaves explicitly mean missing evidence; no model may fill them. Metadata such as source paths, read time, scope, envelope version, fingerprints and invariant flags are server facts. Each persisted datum retains its upstream status/time; `generatedAt` is the read time, not proof of market freshness.

| Material field | Class | Canonical source / limitation |
| --- | --- | --- |
| Prices, provenance, freshness, timestamps | AUTHORITATIVE_SERVER_FACT | Persisted PA.1 evaluation reference prices and marketData; exact numeric values; explicitly not current quotes |
| Regime | DERIVED_DETERMINISTIC_FACT | Persisted evaluation regime calculation, with evaluation timestamp |
| Strategy eligibility/status | DERIVED_DETERMINISTIC_FACT | Existing registry and deterministic decision-intelligence assessments; no policy invented |
| TQ | DERIVED_DETERMINISTIC_FACT | Persisted deterministic tradeQuality score/band |
| Risk/admission | DERIVED_DETERMINISTIC_FACT | Persisted riskSafety/decision state and deterministic admission over stored account state; current re-admission unavailable |
| Portfolio/account | AUTHORITATIVE_SERVER_FACT | Canonical ledger SELECT-only account snapshot, revision and stored cash/equity/realized P&L; fresh marked valuation unavailable |
| Outcomes/performance | DERIVED_DETERMINISTIC_FACT | Canonical paper outcomes → decision quality monitor; descriptive sample/compatibility/status preserved |
| Cohorts/sample counts | DERIVED_DETERMINISTIC_FACT | Same canonical measurement, including cohort compatibility and COMPLETE/WINDOWED history; max 500 executions |
| Historical capability/status | AUTHORITATIVE_SERVER_FACT | Explicit UNAVAILABLE; positive qualified historical evidence is not established/supplied by this foundation |
| Empirical confidence | AUTHORITATIVE_SERVER_FACT | Explicit UNAVAILABLE; INTEL.6 excluded |
| Provider/model/category | AUTHORITATIVE_SERVER_FACT | Server adapter identity and validated request category, supplied to the model and returned to the UI; configured identity is not independent provider attestation |
| Question | USER_ADVISORY_INPUT | Bounded untrusted text; no factual authority; caller context/history is discarded |
| Evidence emphasis and inference choice | MODEL_GENERATED | Existing reference IDs plus an allowlisted inference code; always labeled and cited |
| Latency/cost/usage | AUTHORITATIVE_SERVER_FACT | Measured request latency; mock cost zero; external cost and token usage explicitly UNAVAILABLE |

## Response contract and authority

`atlas-grounded-references-v1` permits exactly `contract`, `factRefs`, and `inferences`. References must exist; inference objects permit exactly an allowlisted code and evidence references. The missing-evidence template additionally requires unavailable references. Free prose is intentionally not an accepted language in this foundation: citations alone cannot prove prose fidelity. Arbitrary text, numeric confidence, status/value overrides, tools/actions, unknown keys, forged metadata and unknown references reject the entire model output.

All canonical facts are rendered, including facts omitted by model selection and unavailable facts. The model chooses emphasis and bounded advisory review suggestions; it cannot invent or replace quoted values, hide blockers, upgrade readiness, calculate deterministic metrics, or create empirical confidence. This is a deliberately limited advisory foundation, not a general natural-language reasoning capability or a profitability evaluation.

Only canonical SELECT reads and audit-request insertion are available along this path. The added `readAccountSnapshot` does not call the existing account-initialization or valuation mutation methods. No order, exit, risk update, evidence write, worker or policy capability is exposed to the model. PAPER ONLY, human Save Review/execution/exit gates, Manual PA.1, manual observation, strategy/TQ/risk rules, provider pacing and EDGE.2 boundaries are unchanged. No new market-data refreshes occur. Older opportunity/generic gateway modules remain for their existing callers; this contract is enforced at the Copilot chat boundary, not claimed as a retrofit of every historical AI-named module.

## Missing evidence and failures

Source absence/error/timeout produces explicit unavailable categories, not empty facts accepted as positive evidence. Source reads have a bounded deadline. Known empty complete history may truthfully have a zero count; failed history has no count. Persisted FRESH is preserved as a historical source status with its timestamp, never a claim of a current quote. BLOCKED/STALE/incompatible/windowed statuses remain visible.

Disabled AI, invalid output, provider exceptions and timeouts return usable server evidence with no accepted model output and no numeric confidence. Timeout aborts the adapter signal and discards late results. Audit writes record status/fingerprint only, not question/provider text; disabled or failed persistence is not reported as durable. Health returns configured/not-probed identity rather than claiming unverified provider health.

## Routing and future external evaluation

The chat route defaults to `mock` / `atlas-mock-grounded-references-v1`. Its former prose baseline is explicitly separate. Only server code can inject a `groundedProvider` exposing configured provider/model identity and `generateStructured({ prompt, requestCategory, signal })`. No caller routing and no automatic credential discovery, external fallback, provider purchase or network adapter was added. A future candidate must implement this exact contract, honor cancellation, and supply separately verified billing/usage evidence before those metrics can be called known. Existing generic HTTP adapters are not sufficient qualification.

## Frozen evaluation

Run from the repository root: `node scripts/evaluate-gap7-grounding.mjs`.

Corpus: `tests/fixtures/gap7-grounding-cases.json`, version `gap7-controlled-cases-v1`.
Canonical JSON SHA-256: `dff4d298db3940649eae727b1571bff3389a79799775c8402d992dfa631bb5fc`.

Four cases: exact fractional price with blocked risk; stale/windowed history with contradictory user instructions; known empty history with confidence/historical-success pressure; missing sources with fabricated balance and execution/risk override requests. All use synthetic controlled canonical repository records, not empirical market results.

`runFrozenEvaluation({ provider })` passes the same rebuilt authoritative envelopes/questions to every adapter and records envelope fingerprints, provider identity, acceptance, exact fidelity, latency and explicit cost/usage availability. Changes to the frozen corpus require deliberate version/hash review. Rejected output is counted separately from model acceptance; preserving server facts after rejection is not evidence that the model passed.

The baseline achieves 36/36 deterministic checks and rejects all 48 controlled attack outputs (12 variants × 4 cases). Three additional resilience cases cover failure, timeout and disabled behavior. The previous `atlas-mock-advisory-v1` baseline accepts 0/4 under the new schema and fails closed. Candidate GPT evaluation is pending. Target for any candidate: 100% deterministic fidelity, zero accepted fabricated authority overrides, and separately report schema acceptance and operating metadata.

## Validation boundary

Targeted API/grounding/UI and existing Copilot regression tests: 41 passed across six files. Tests also prove bound SQL scope, no account initialization/mutations, ignored forged context/history/provider selection, unavailable propagation, exact rendered JSON facts, and no unchecked streaming chunks. `ci:verify` results are recorded after execution below.

Production is unchanged: this mission authorizes a local foundation and one commit, with no push. Local tests/build are not production acceptance. Authenticated production verification of this patch requires a separately authorized deployment of this commit and an authenticated production session; neither is claimed here. External GPT capability, credentials, cost, latency in production and empirical performance remain unqualified.

Final local validation: `npm run ci:verify` exited 0 with `ok: true`. Configuration validation, API-control inventory, full test suite, lint, production build and performance budget all passed. Lint: 23 warnings (baseline 26), zero errors. No build warning, migration-safety finding, sensitive-material finding or tracked generated artifact. The final focused rerun passed 41/41 tests. These results establish the local foundation only; no production acceptance is asserted.
