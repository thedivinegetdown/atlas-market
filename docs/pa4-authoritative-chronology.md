# PA.4 chronology contract v1 — provider pending

Baseline: `65efc2983ee9b204a94c35e2b4d7c5d6d778911a`.

The existing frozen policies prescribe session-level prices, while a current quote
and caller-supplied bars cannot establish the first post-entry trigger. The ledger
previously contained this mismatch by rejecting every policy-bound close. This
change adds the server evidence architecture without qualifying any data provider.

## Server ownership and qualification

`createCanonicalPaperLedgerRepository` constructs `createExitEvidenceService`.
Only server composition can supply `exitEvidenceSource`,
`exitEvidenceQualification`, and an optional clock. Production composition supplies
none: `getExitEvidence()` returns `AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE`. No HTTP
field or environment switch enables a provider. Existing market-overview quotes
remain marks/cost context and cannot become chronology. No vendor adapter, purchase,
configuration, qualification claim, or automatic execution is included.

A future independently reviewed qualification must identify provider, source,
qualification reference, validity interval, evidence class (`GENUINE` or
`SYNTHETIC`), and exact qualified symbol/MIC/IANA-timezone triples. It must explicitly
cover `finalMinutes`, `completePagination`, `completeCalendar`, `sessionOpenClose`,
`corporateActions`, and `retainedContent`. These are integration preconditions,
not assertions that any current provider offers these guarantees. A provider's
response cannot qualify itself. Qualification is snapshotted at service creation.

The adapter implements `source.retrieve(request)` with `source.provider` and
`source.id`. It owns provider pacing, request timeout, retries, and archive retention;
this boundary adds no polling or independent pacing bypass. Retrieval currently
occurs under the existing account/position transaction locks to bind the result
to the same revision that is committed. Adapter timeout must bound this lock time.

## Neutral envelope

The immutable server request contains contract version, ledger symbol and entry
execution ID, entry time, server as-of time, 60,000 ms interval,
`includeContainingEntryMinute: true`, regular session type, and `UNADJUSTED` basis.
The source must return:

- Matching `provider`, `source`, `evidenceClass`, and exact `request`.
- `instrument: {symbol, mic, timezone}` matching independently qualified coverage.
- `quality: {finality: 'FINAL', corrections: 'RESOLVED', completeness: 'COMPLETE',
  paginationComplete: true, snapshotId, finalAsOf}`. `finalAsOf` attests the snapshot
  and correction state as of retrieval, not merely the last candle timestamp. It
  must cover the requested as-of time and cannot exceed server retrieval time.
- `calendar: {id, revision, complete: true, mic, timezone, days}`. Every local date
  from entry through as-of is present consecutively, including non-trading dates
  with `sessions: []`. Each supported day contains at most one regular session
  `{id, openAt, closeAt}` with explicit offset-aware timestamps. Missing days,
  duplicate IDs, overlapping sessions, and unfinished sessions are rejected.
  Calendar completeness/closures must come from a qualified calendar source;
  Atlas never guesses weekdays, holidays, DST, or early closes.
- `sessionPrices: [{sessionId, status: 'VERIFIED_FINAL', reference, open, close}]`
  covering exactly the elapsed sessions. The qualified source must verify these
  session opening/closing prices (including auction treatment) independently of
  merely selecting its first/last available candle. Later-session minute opens
  must match the verified session open; every reconstructed close must match the
  verified session close. Missing or mismatched prices fail closed.
- `corporateActions: {status: 'NO_ACTIONS', basis: 'UNADJUSTED', entryExecutionId,
  from, through, reference}` covering entry through as-of. V1 deliberately rejects
  adjustments, relevant actions, and unknown action coverage. It never mixes an
  adjusted history with unadjusted policy levels or guesses adjustment factors.
- `pages: [{id, archiveReference, rawContent, content}]`. `rawContent` is the exact
  original provider UTF-8 response text, hashed before normalization. `content` is
  the separately hashed normalized JSON text with `{minutes: [...]}`; each minute has `sessionId`, `startAt`, `endAt`, and
  numeric positive coherent `open/high/low/close`. Pages contain exactly the entry
  minute and later regular-session intervals requested. No preceding minutes,
  duplicates, missing/no-trade intervals, or extended-hours substitutions pass.
  Archive references must identify both immutable retained forms, contain no secrets,
  and be available for replay. Raw content is hashed but never included in the ledger
  manifest. The normalized adapter envelope and its mapping to
  the provider's original content are part of provider qualification.

Unknown or unresolved semantics fail closed. Schema assertions and content hashes
do not themselves prove provider completeness, finality, corrections, or retention.

## Entry-relative session semantics

The authoritative paper entry time is the ledger execution insertion timestamp.
New entries use PostgreSQL `clock_timestamp()` and carry
`paper-entry-ledger-clock-v1` / `execution_created_at`. Transaction-start `NOW()`,
evaluation timestamps, policy creation timestamps, and request timestamps are not
substitutes. Legacy rows without the explicit time basis remain unavailable. A
single intact entry is supported; multiple-entry or reduced lifecycles require
future lot-level chronology and remain unavailable.
Exit execution insertion uses the same database clock, so a transaction that began
earlier but waited on the account lock cannot sort its close before the entry.

The entry minute's full range must prove neither stop nor target was touched,
even for an entry exactly on the minute boundary. Otherwise ordering is ambiguous
and the result is unavailable. Its safe range can then be omitted. All later
minutes through the entry-session close, and every minute in later sessions, are
required. Missing intervals are never forward-filled or fabricated.

Only completed regular sessions are supported. This deliberately means waiting
for a final session before policy attribution; an intraday target cannot be accepted
while a later same-session stop remains possible. The entry session is session 1;
closed calendar dates do not increment the count. Full evidence through the
requested as-of is required even if an earlier trigger is found.

Minutes are aggregated, never individually evaluated as policy bars. For the entry
session, the frozen policy entry price is an explicitly labeled neutral open anchor
to disable pre-entry/session-gap claims; the anchor lies between frozen thresholds.
Subsequent opens use the first minute of the verified session. Session highs/lows
preserve stop-first ambiguity even when a target minute precedes a stop minute.
The first triggering session wins. The unchanged frozen evaluator determines the
trigger and prescribed price, including adverse open gaps, target caps, and the
verified session-20 close for index pullback (other policies keep their own limits).
`FRESH` on reconstructed policy bars denotes verified final evidence at retrieval;
it does not replace the historical session close timestamp with the current time.

## Immutable manifest and ledger

The deeply frozen manifest contains organization/team/account/user scope, account
record, position/revision/quantity/side, entry execution/time/fill, evaluation and
intent fingerprints, both frozen policy fingerprints, symbol/MIC/timezone, source,
qualification reference/hash, retrieval parameters/time, raw-page SHA-256 hashes and
archive references, envelope content hash, complete calendar identity/sessions,
corporate-action basis, evaluator version, reconstructed bars, and selected decision.
Its canonical SHA-256 covers the complete manifest. The entry/position binding has
its own hash. This is content-addressed audit evidence, not a cryptographic signature
or a claim of tamper-proof storage against database administrators.

Only an in-process branded receipt can cross from the service to the ledger. JSON
copies/replay, asserted manifests, caller bars/session counts/policies, and receipts
bound to another scope/revision cannot authorize a close. Human confirmation and
PAPER ONLY remain mandatory. Compliant exits use the policy price with existing
slippage, fees, entry-fee allocation, risk, valuation, and atomic ledger semantics.
Manifest and its attribution hash are included in the same append-only execution
insert as the close, within the existing revision-guarded transaction. Canonical
outcomes retain the manifest. Forward cohort counts additionally require a genuine
manifest and matching attribution hash; old flag-only outcomes and synthetic
evidence cannot count. This does not activate EDGE.2 or change its preregistration.

Emergency/manual close remains the explicit `manual_emergency` path. It bypasses
chronology, uses the fresh quote, requires human confirmation, carries no authoritative
manifest, and is non-compliant/excluded from cohort minimums. Missing authority keeps
the existing rejection blocker and adds the explicit
`chronologyStatus: AUTHORITATIVE_CHRONOLOGY_UNAVAILABLE` plus a sanitized reason.

## Controlled validation and acceptance limit

`pa4-authoritative-chronology.test.js` uses artificial four-minute sessions. It covers
both sides, stop/target, session ambiguity/order, entry ambiguity, true gaps, false
intraminute gaps, first-session trigger, maximum hold, quality gaps, finality,
corrections, pagination, immutable binding, replay, and provider failure containment.
Transactional harness cases cover manifest persistence/readback, duplicate
suppression, request forgery, partial-close rejection, synthetic exclusion, legacy
entry rejection, and emergency close. These fixtures never call a live database,
provider, or collector. Fixture `GENUINE` labels exercise the harness branch only
and supply no qualification evidence.

Successful tests/build/CI establish code readiness only. Production acceptance and
provider qualification remain pending; the default deployed behavior stays unavailable.
