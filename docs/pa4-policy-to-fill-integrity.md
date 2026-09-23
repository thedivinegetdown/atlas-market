# PA.4 policy-to-fill integrity — bounded containment

Baseline: `e4a086bd270a4ae4b106bbfc487a0cb1de36c2b6`.

## Proven defect

The exit calculator evaluated the frozen policy against `policyBar` but sent the
current quote to the execution simulator. A synthetic long-position case with
stop 98, target 104, OHLC 100/105/97/103, and a later quote of 110 returned
`same_bar_stop_target_stop_first`, fill 109.94, and compliant attribution.
The prescribed reference was 98. The HTTP endpoint forwarded caller bars and
session counts, while the ledger accepted a supplied exit policy and dropped
the entry evaluation evidence fingerprint from exit payloads.

## Authoritative capability boundary

`getMarketOverview()` supplies a point quote to PA.4. The historical provider
supports exactly 260 daily candles and rejects intraday intervals and custom
ranges. `historicalCandleNormalizer` reduces date strings to midnight UTC and
deduplicates dates. These are useful indicator inputs, but do not establish
post-entry intraday coverage, absence of earlier triggers, entry-session
ordering, or a verified exchange-session count and session-20 close.

There is no available authoritative chronology adapter for this contract.
No quote is converted to OHLC; no calendar days are converted to sessions.
Policy-governed durable exits therefore return
`authoritative_exit_chronology_unavailable` with no fill/account/position write.
This is containment, not completion of the positive production policy-exit path.
The final mission status remains **BLOCKED** pending that capability.

## Contract after containment

1. Authentication, tenant scope, CSRF, and explicit human confirmation remain
   mandatory. The canonical ledger also requires explicit confirmation.
2. The endpoint excludes caller bars, session counts, policies, prices, and
   claimed evidence from its ledger request. The ledger loads entry policies
   and fingerprints under the existing account/position transaction locks.
3. Policy exits, ambiguous entry linkage, and missing Index Pullback policy
   evidence fail closed. No injected request field can open the gate.
4. The pure calculator uses the policy's prescribed conservative price as its
   execution reference. It requires explicit valid, fresh OHLC and retains
   same-bar stop-first and frozen gap/maximum-hold behavior. Pure calculator
   fixtures are mathematical validation; they are not authoritative chronology
   and cannot be submitted as durable compliant outcomes.
5. Existing confirmed `manual_emergency` closes remain quote-based, including
   reductions. They retain stale-quote, quantity, paper-mode, isolation, atomicity,
   and duplicate guards. Their policy compliance and EDGE.2 outcome eligibility
   are always false, including when policy evidence is missing.
6. Exit payloads preserve originating evaluation evidence fingerprints, exact
   frozen policies, and all linked entry policy/cohort identities. Mixed entries
   cannot be promoted by matching only a policy definition fingerprint.

## Costs and ledger reconciliation

The existing market slippage model remains 2 base + 3 market bps, with 4 extra
bps below liquidity score 60. Slippage worsens a sell/cover relative to the
prescribed reference, rounded to the existing asset precision. Equity/ETF fees
remain max(0.25, filled notional × 0.0005), rounded to cents. Other asset fee and
multiplier conventions are unchanged. The exit plan records the prescribed
price separately from current quote, fill, fees, slippage, and model identifiers.

Example: reference 98, 10 long shares at average cost 100, liquidity 80 yields
97.95 fill, 0.49 exit fee, 979.01 cash credit, and -20.99 realized exit P&L.
With an entry fee of 1 already charged, cash moves from 98,999 to 99,978.01;
the existing realized-exit convention excludes that previously paid entry fee.
The position becomes quantity 0. No fee convention was changed.

## Controlled validation and safety

Fixtures cover long/short stop, target, same-bar touches, adverse/favorable gaps,
maximum hold, stale/missing/future/malformed bars, forged session counts and
policies, missing durable linkage, confirmation, and emergency/manual closes.
The existing transactional harness covers rollback, retries, concurrent close,
short accounting, and tenant isolation. All fixtures are local, synthetic,
and use pure functions, injected endpoint dependencies, or the in-memory SQL
harness. No production evidence collection, paper execution, migration, or
deployment is performed. EDGE.2 is not advanced; INTEL.6 remains gated.

Validation results are recorded in the final task report. Source, tests, build,
and local CI checks do not constitute production acceptance.
