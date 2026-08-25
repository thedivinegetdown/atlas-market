# Atlas Market Deterministic Trade Quality Score

Version: `trade-quality-v1`

## Purpose and boundaries

TQ.1 assigns a deterministic 0–100 advisory quality score to an existing Atlas opportunity candidate. The provider-neutral entry point is:

```js
scoreTradeQuality({ candidate, regime, strategySuitability, marketContext, riskContext })
```

The engine consumes resolved evidence only. It cannot call providers, calculate indicators, invoke AI, rank scanner results, activate a strategy, create an order, mutate a portfolio, or override deterministic risk controls. Results always declare the paper-trading-only, advisory-only, no-auto-activation, and unchanged-scanner-ranking boundaries.

## Candidate sources and input contract

TQ.1 reuses `normalizeOpportunityContract()` from `lib/ai/opportunityAnalysisEngine.js`, Atlas's existing safe opportunity contract. Despite its current module ownership, candidate normalization is deterministic and does not call an AI provider.

| Source | Repository status | Evidence available to TQ.1 |
| --- | --- | --- |
| Scanner matches from `lib/scanners/scannerEvaluator.js` | Production-integrated | Symbol, scanner identity, matched criteria, asset type, and evaluation time; insufficient alone for a quality score |
| Canonical opportunity contract | Production-compatible read-only contract used by opportunity analysis APIs | Strategy identity, direction, deterministic metrics, regime/liquidity/volatility/risk summaries, freshness, missing data, and hard rejections when supplied by an approved caller |
| Strategy `index-pullback-v1` | Modeled, comprehensively tested, human-review lifecycle | Versioned SI.1 suitability result; scanner review may evaluate it as the sole approved strategy, but cannot activate it or turn `CONDITIONAL` into `ENABLED` |
| Other opportunity and strategy fixtures | Test-only | Used only for deterministic test coverage |

The engine accepts numeric strings only where they represent finite numbers. Invalid values are omitted. It does not infer a strategy, risk/reward ratio, liquidity state, or missing indicator value for a lean scanner match.

## Dimensions and weights

Weights are centralized in `lib/opportunities/quality/tradeQualityConfig.js` and total 100:

| Dimension | Weight | Accepted evidence |
| --- | ---: | --- |
| Market regime fit | 15 | Candidate direction aligned to the MI.1–MI.5 trend regime |
| Strategy suitability | 20 | SI.1 `ENABLED`, `CONDITIONAL`, `DISABLED`, or `UNKNOWN` decision for the same strategy identifier |
| Trend | 15 | Existing normalized deterministic trend score |
| Momentum | 10 | Existing normalized deterministic momentum score |
| Relative strength | 10 | Existing relative-strength value versus the approved benchmark |
| Volume confirmation | 10 | Existing relative-volume ratio |
| Volatility quality | 5 | Existing volatility status or ATR percentile |
| Liquidity | 5 | Existing liquidity status and/or spread percentage |
| Risk/reward | 10 | Existing positive reward-to-risk ratio |

Available dimensions are normalized against their configured weights. A dimension is absent—not zero-filled—when its evidence is unavailable. Thresholds are review heuristics and do not guarantee performance.

## Bands, confidence, and coverage

- `EXCEPTIONAL`: 90–100
- `STRONG`: 80–89
- `QUALIFIED`: 70–79
- `WATCH`: 55–69
- `WEAK`: 0–54
- `UNKNOWN`: minimum evidence is not met

Evidence coverage is the percentage of configured weight backed by available dimensions. A numeric score requires at least 55% weighted coverage and at least two core dimensions among regime fit, strategy suitability, liquidity, and risk/reward. Otherwise the score and band are `null`/`UNKNOWN` and status is `INSUFFICIENT_DATA`.

Confidence measures evidence completeness, not setup quality. It begins with coverage and applies penalties for stale evidence, partial/invalid/insufficient regime status, and blockers. `COMPLETE`, `PARTIAL`, `INSUFFICIENT_DATA`, and `INVALID_INPUT` are distinct statuses.

## Safety gates

- Stale or invalid regime evidence cannot produce a score above 54; invalid or insufficient regimes fail the minimum-evidence gate.
- A partial regime caps the score at 69.
- A disabled strategy decision caps the score at 54 and is reported as a blocker.
- Thin, stressed, failed, or excessive-spread liquidity caps the score at 54.
- Candidate hard rejections and strategy blocking prerequisites cap the score at 54.
- Invalid or non-positive risk/reward input is omitted and cannot improve the score.
- AI context and callback-like side effects are ignored. Existing risk guardrails retain final authority.

## Read model and data flow

The stable result contains engine version, symbol, strategy identifier, candidate as-of time, score, band, confidence, status, coverage, weighted dimension breakdown, deterministic reasons, blockers, missing inputs, freshness, and explicit boundaries.

The read-only integration is:

`Scanner match` → explicit **Review quality** selection → authenticated `trade-quality` Netlify Function → one existing market-overview orchestration → SI.1 evaluation from that same regime → TQ.1 engine → compact read model.

No request occurs merely because a match renders. Evaluation starts only after explicit review. It makes no provider request per dimension or strategy, exposes no candles or credentials, and does not write to persistence. Existing MI.5 cache, in-flight deduplication, provider budget, and authentication controls remain authoritative.

## UI and observability

The Scanner opportunity-review surface displays score/band, confidence, coverage, freshness, dimension contributions, deterministic reasons, missing inputs, blockers, and the paper/advisory boundaries. Loading, error, partial, and insufficient states use text and do not rely on color. No trade, activation, or ranking control is added.

Diagnostics contain engine version, band, status, confidence, missing-input count, blocker count, and duration only. They exclude raw candidates, candles, provider credentials, and secrets.

## Bounded opportunity-intelligence retention

OI.1 reuses `atlas_ai_opportunity_analysis_history`, the existing tenant/account/user-scoped opportunity review history. It adds no repository table or migration. An explicit approved review may retain a compact `tradeQualitySnapshot` inside the existing history payload with opportunity ID, symbol, strategy ID, score, band, confidence, quality status, up to three deterministic reasons and blockers, missing-input names, freshness/as-of metadata, review state, and engine version.

Only `saved` and `reviewed` snapshots with valid symbol and strategy context, a valid `trade-quality-v1` score, and unexpired retention are eligible for the Daily Briefing feed. Compact snapshots default to the existing 30-day opportunity-history retention window unless an earlier valid expiry is supplied. `dismissed` and `expired` records are excluded. Raw candles, provider responses, prompts, secrets, and oversized market payloads are neither accepted into nor returned from the compact snapshot.

The feed is capped at five by contract and three for DB.1. Ordering is deterministic: score descending, confidence descending, as-of time descending, then stable opportunity ID. This ordering applies only to the briefing feed and never changes scanner ranking. Stale results retain `STALE` freshness and receive conservative briefing treatment.

Snapshot retention is an explicit human review action. It does not start background scoring, rescore scanner matches, call providers or AI, activate strategies, create orders, or mutate portfolios.

## Limitations and future work

- Current production scanner matches are intentionally lean and do not carry canonical strategy, liquidity, risk/reward, or normalized indicator evidence. They therefore commonly return `UNKNOWN` until an approved opportunity composition path supplies those fields.
- The production environment still needs a server-side Twelve Data key to verify live historical regime evidence. Fixed deterministic fixtures validate the complete data flow without provider availability.
- TQ.1 does not change scanner ordering. A future scanner-ranking phase may consume the versioned read model only through a separately approved execution order and acceptance criteria.
- Daily Briefing and automated paper trading are out of scope.
