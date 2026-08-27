import { buildStrategyFamilyRegistry } from '../../strategies/registry/index.js'

export const PORTFOLIO_ADMISSION_VERSION = 'portfolio-admission-v1'
export const PORTFOLIO_ADMISSION_STATUSES = Object.freeze(['ADMITTED', 'WATCH', 'BLOCKED', 'INSUFFICIENT_DATA'])

const text = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function strategyFamily(strategyId, registry) {
  return registry.strategies.find((entry) => entry.strategyId === strategyId)?.familyId ?? null
}

function activePositions(positions) {
  return positions.filter((position) => String(position?.status ?? 'open').toLowerCase() === 'open' && Number(position?.quantity) > 0)
}

export function buildPortfolioAdmission({ plan = {}, positions, account = {}, registry = buildStrategyFamilyRegistry(), correlationEvidence = null, generatedAt = new Date().toISOString() } = {}) {
  const reasons = []
  const cautionReasons = []
  const strategyId = text(plan.strategyId)
  const familyId = strategyId ? strategyFamily(strategyId, registry) : null
  const scopeAccountId = text(account.accountId ?? plan.accountId)
  const base = {
    version: PORTFOLIO_ADMISSION_VERSION,
    planId: text(plan.planId),
    symbol: text(plan.symbol)?.toUpperCase() ?? null,
    side: text(plan.side),
    strategyId,
    familyId,
    accountId: scopeAccountId,
    duplicateSymbolStatus: 'UNAVAILABLE',
    existingSymbolExposure: null,
    concentrationStatus: 'UNAVAILABLE',
    strategyOverlapStatus: 'UNAVAILABLE',
    correlationStatus: correlationEvidence?.status ? String(correlationEvidence.status).toUpperCase() : 'UNAVAILABLE',
    reasons,
    cautionReasons,
    evidenceAvailability: { positions: Array.isArray(positions) ? 'AVAILABLE' : 'UNAVAILABLE', account: scopeAccountId ? 'AVAILABLE' : 'UNAVAILABLE', correlation: correlationEvidence?.status ? 'AVAILABLE' : 'UNAVAILABLE', strategyAttribution: 'UNAVAILABLE' },
    generatedAt,
    advisoryOnly: true,
    paperTradingOnly: true,
    executable: false,
  }
  if (!base.planId || !base.symbol || !strategyId || !scopeAccountId || !Array.isArray(positions)) {
    reasons.push('Required plan, account, or authoritative position evidence is unavailable.')
    return Object.freeze({ ...base, admissionStatus: 'INSUFFICIENT_DATA' })
  }
  const scoped = activePositions(positions).filter((position) => text(position.accountId) === scopeAccountId)
  const sameSymbol = scoped.filter((position) => text(position.symbol)?.toUpperCase() === base.symbol)
  const exposure = sameSymbol.reduce((total, position) => total + Math.abs(Number(position.quantity) * Number(position.currentPrice ?? position.averagePrice)), 0)
  base.duplicateSymbolStatus = sameSymbol.length ? 'CONFLICT' : 'CLEAR'
  base.existingSymbolExposure = exposure
  if (sameSymbol.length) reasons.push(`An open ${base.symbol} position already exists in this paper account.`)
  const accountEquity = Number(account.equity)
  if (Number.isFinite(accountEquity) && accountEquity > 0) {
    base.concentrationStatus = exposure / accountEquity >= 0.25 ? 'ELEVATED' : 'CLEAR'
    if (base.concentrationStatus === 'ELEVATED') cautionReasons.push('Existing symbol exposure is at least 25% of account equity.')
  } else cautionReasons.push('Account equity is unavailable; concentration cannot be determined.')
  const attributed = scoped.filter((position) => text(position.strategyId))
  base.evidenceAvailability.strategyAttribution = attributed.length || scoped.length === 0 ? 'AVAILABLE' : 'PARTIAL'
  const sameFamily = attributed.filter((position) => strategyFamily(text(position.strategyId), registry) === familyId)
  base.strategyOverlapStatus = familyId ? (sameFamily.length ? 'SAME_FAMILY_EXPOSURE' : 'CLEAR') : 'UNAVAILABLE'
  if (sameFamily.length) cautionReasons.push(`Open exposure already uses strategy family ${familyId}.`)
  if (base.correlationStatus === 'UNAVAILABLE') cautionReasons.push('Authoritative correlation evidence is unavailable.')
  const admissionStatus = sameSymbol.length ? 'BLOCKED' : (base.concentrationStatus === 'ELEVATED' || sameFamily.length || base.correlationStatus === 'UNAVAILABLE' ? 'WATCH' : 'ADMITTED')
  return Object.freeze({ ...base, admissionStatus })
}