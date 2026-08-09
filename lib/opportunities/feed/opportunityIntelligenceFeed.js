import { isValidSymbol } from '../../validation/requestValidators.js'

export const OPPORTUNITY_FEED_VERSION = 'opportunity-intelligence-v1'
export const ELIGIBLE_REVIEW_STATES = Object.freeze(['reviewed', 'saved'])
export const DEFAULT_OPPORTUNITY_RETENTION_DAYS = 30

function boundedText(value, max = 240) { return String(value ?? '').trim().slice(0, max) }
function boundedList(value, limit = 3) { return Array.isArray(value) ? value.map((item) => boundedText(item)).filter(Boolean).slice(0, limit) : [] }
function finite(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }

export function normalizeTradeQualitySnapshot(input = {}) {
  const opportunityId = boundedText(input.opportunityId ?? input.id, 160)
  const symbol = boundedText(input.symbol, 20).toUpperCase()
  const strategyId = boundedText(input.strategyId, 140)
  const score = finite(input.score)
  const confidence = finite(input.confidence)
  const asOf = input.asOf ? new Date(input.asOf) : null
  const reviewState = boundedText(input.reviewState ?? 'saved', 20).toLowerCase()
  if (!opportunityId) throw new Error('opportunity id is required')
  if (!isValidSymbol(symbol)) throw new Error('opportunity symbol is invalid')
  if (!strategyId || strategyId === 'strategy-unknown') throw new Error('opportunity strategy context is required')
  if (score == null || score < 0 || score > 100) throw new Error('trade quality score is invalid')
  if (confidence == null || confidence < 0 || confidence > 100) throw new Error('trade quality confidence is invalid')
  if (!input.engineVersion || input.engineVersion !== 'trade-quality-v1') throw new Error('trade quality engine version is invalid')
  if (!asOf || Number.isNaN(asOf.getTime())) throw new Error('trade quality as-of time is invalid')
  if (!ELIGIBLE_REVIEW_STATES.includes(reviewState)) throw new Error('opportunity review state is invalid')
  return {
    opportunityId, symbol, strategyId, score: Math.round(score), band: boundedText(input.band ?? 'UNKNOWN', 30).toUpperCase(), confidence: Math.round(confidence),
    qualityStatus: boundedText(input.status ?? input.qualityStatus ?? 'INSUFFICIENT_DATA', 40).toUpperCase(), reasons: boundedList(input.reasons), blockers: boundedList(input.blockingReasons ?? input.blockers), missingInputs: boundedList(input.missingInputs, 10), freshness: boundedText(input.freshness ?? 'UNKNOWN', 20).toUpperCase(), asOf: asOf.toISOString(), reviewState, engineVersion: 'trade-quality-v1',
    boundaries: { advisoryOnly: true, paperTradingOnly: true },
  }
}

export function buildBoundedOpportunityFeed(records = [], { limit = 3, now = new Date().toISOString() } = {}) {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 3))
  const nowMs = new Date(now).getTime()
  return records.map((record) => {
    const snapshot = record?.payload?.tradeQualitySnapshot ?? record?.tradeQualitySnapshot
    if (!snapshot) return null
    try {
      const normalized = normalizeTradeQualitySnapshot({ ...snapshot, reviewState: record.reviewState ?? snapshot.reviewState })
      return { ...normalized, reviewedAt: record.reviewedAt ?? null, expiresAt: record.expiresAt ?? null, stale: normalized.freshness === 'STALE' }
    } catch { return null }
  }).filter((item) => item && ELIGIBLE_REVIEW_STATES.includes(item.reviewState) && (!item.expiresAt || new Date(item.expiresAt).getTime() > nowMs))
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || new Date(right.asOf).getTime() - new Date(left.asOf).getTime() || left.opportunityId.localeCompare(right.opportunityId))
    .slice(0, safeLimit)
}
