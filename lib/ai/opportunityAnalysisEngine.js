import { AppError } from '../errors/appError.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { ATLAS_AI_NOTICE, sanitizeAiText, validateAtlasAiStructuredResponse } from './atlasAiGateway.js'

export const OPPORTUNITY_ANALYSIS_EVENTS = Object.freeze({
  requested: 'atlasAi.marketAnalysisRequested',
  completed: 'atlasAi.marketAnalysisCompleted',
  failed: 'atlasAi.marketAnalysisFailed',
  ranked: 'atlasAi.opportunitiesRanked',
  noTrade: 'atlasAi.noTradeRecommended',
  excluded: 'atlasAi.candidateExcluded',
  staleBlocked: 'atlasAi.marketDataStaleBlocked',
  deterministicRejection: 'atlasAi.deterministicRejectionApplied',
  invalidStructuredResponse: 'atlasAi.invalidStructuredResponse',
})

export const OPPORTUNITY_ANALYSIS_CATEGORIES = Object.freeze([
  'market_overview',
  'opportunity_ranking',
  'trade_idea_analysis',
  'watchlist_prioritization',
  'market_regime_analysis',
  'candidate_comparison',
  'no_trade_analysis',
])

export const OPPORTUNITY_TIMEFRAMES = Object.freeze(['intraday', 'session', 'swing', 'position', 'multi_day'])
export const OPPORTUNITY_REVIEW_STATES = Object.freeze(['new', 'reviewing', 'saved', 'dismissed', 'expired'])
export const OPPORTUNITY_REVIEW_FEEDBACK = Object.freeze(['useful', 'not_useful', 'inaccurate', 'needs_more_evidence'])

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/
export const OPPORTUNITY_ANALYSIS_VERSION = 'atlas-opportunity-analysis-v2'
export const OPPORTUNITY_RANKING_VERSION = 'atlas-opportunity-ranking-v1'
export const OPPORTUNITY_EXPLAINABILITY_VERSION = 'atlas-opportunity-explainability-v1'

function nowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function stableString(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value).trim()
}

function clampNumber(value, fallback = 0, min = 0, max = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeList(items = [], limit = 8) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item) => stableString(item, '')).filter(Boolean)
}

function clampScore100(value, fallback = 0) {
  return Math.round(clampNumber(value, fallback, 0, 100) * 100) / 100
}

function uniqueList(items = [], limit = 8) {
  return Array.from(new Set(normalizeList(items, limit * 2).map((item) => sanitizeAiText(item, 180)))).filter(Boolean).slice(0, limit)
}

function normalizeObject(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value).sort().reduce((next, key) => {
      const sanitizedKey = String(key).slice(0, 80)
      next[sanitizedKey] = value[key]
      return next
    }, {})
  }
  return value
}

function stableFingerprint(value) {
  const text = JSON.stringify(stableString(value, ''))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `opportunity-${hash.toString(16).padStart(8, '0')}`
}

function invalidRequest(message, metadata = {}) {
  throw new AppError('invalid_request', message, { statusCode: 400, publicMessage: message, metadata })
}

function isValidSymbol(symbol) {
  return SYMBOL_PATTERN.test(String(symbol ?? '').toUpperCase())
}

function normalizeTimeframe(value = 'session') {
  const timeframe = stableString(value, 'session').toLowerCase()
  if (!OPPORTUNITY_TIMEFRAMES.includes(timeframe)) invalidRequest('opportunity timeframe is invalid', { timeframe: sanitizeAiText(value, 40) })
  return timeframe
}

function normalizeAnalysisCategory(value = 'opportunity_ranking') {
  const category = stableString(value, 'opportunity_ranking').toLowerCase()
  if (!OPPORTUNITY_ANALYSIS_CATEGORIES.includes(category)) invalidRequest('opportunity analysis category is invalid', { category: sanitizeAiText(value, 80) })
  return category
}

function detectUnsafeOpportunityText(value = '') {
  const text = String(value ?? '').toLowerCase()
  const patterns = [
    ['prohibited_trade_action', /place\s+(a\s+)?(live\s+)?(trade|order)|execute\s+(trade|order)|buy\s+\d+|sell\s+\d+|cancel\s+(order|trade)|call\s+broker/],
    ['prohibited_mutation', /modify\s+(position|risk|order)|change\s+risk|approve\s+strategy|start\s+worker|trigger\s+automation|deploy|execute\s+sql|shell\s+command/],
    ['unsupported_price_target', /price\s+target|target\s+price|\$\d+(\.\d+)?\s+target|guaranteed|risk[-\s]?free|cannot\s+lose|will\s+profit/],
  ]
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

function ensureSafeOpportunityText(value = '', field = 'opportunity text') {
  const unsafe = detectUnsafeOpportunityText(value)
  if (unsafe) invalidRequest(`${field} contains prohibited opportunity content`, { unsafe })
  if (/<script[\s\S]*?>|<\/?[a-z][\s\S]*?>/i.test(String(value ?? ''))) invalidRequest(`${field} contains unsafe markup`, { field })
}

export function validateOpportunityAnalysisRequest(input = {}, config = {}) {
  const category = normalizeAnalysisCategory(input.requestCategory ?? input.analysisCategory)
  const timeframe = normalizeTimeframe(input.timeframe ?? 'session')
  const requestedLimit = Number(input.limit ?? input.maxCandidatesPerRequest ?? config.maxCandidatesPerRequest ?? 8)
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) invalidRequest('opportunity result limit is invalid', { limit: input.limit ?? input.maxCandidatesPerRequest })
  const candidates = Array.isArray(input.candidates) ? input.candidates : []
  if (candidates.length > 50) invalidRequest('opportunity candidate count is invalid', { candidateCount: candidates.length })
  const symbols = input.symbols ? normalizeList(input.symbols, 20).map((symbol) => symbol.toUpperCase()) : []
  for (const symbol of symbols) {
    if (!isValidSymbol(symbol)) invalidRequest('opportunity symbol is invalid', { symbol })
  }
  candidates.forEach((candidate, index) => {
    const symbol = stableString(candidate?.symbol ?? 'UNKNOWN').toUpperCase()
    if (symbol !== 'UNKNOWN' && !isValidSymbol(symbol)) invalidRequest('opportunity symbol is invalid', { index, symbol })
    if (candidate?.asOf && Number.isNaN(Date.parse(candidate.asOf))) invalidRequest('opportunity source timestamp is invalid', { index })
    if (candidate?.scannerScore !== undefined && !Number.isFinite(Number(candidate.scannerScore))) invalidRequest('opportunity scanner score is invalid', { index })
    ;['thesis', 'signalSummary', 'direction'].forEach((field) => {
      if (candidate?.[field]) ensureSafeOpportunityText(candidate[field], field)
    })
  })
  return {
    category,
    timeframe,
    limit: requestedLimit,
    symbols,
  }
}

function riskPenalty(riskSummary = {}) {
  const riskScore = clampScore100(riskSummary.score, 0)
  const riskLevel = String(riskSummary.riskLevel ?? riskSummary.severity ?? '').toLowerCase()
  const levelPenalty = riskLevel === 'critical' ? 35 : riskLevel === 'high' ? 24 : riskLevel === 'elevated' ? 16 : riskLevel === 'medium' ? 8 : 0
  return clampScore100(Math.max(levelPenalty, riskScore * 0.35))
}

function freshnessContribution(candidate) {
  const timestamp = Date.parse(candidate.asOf)
  if (!Number.isFinite(timestamp)) return { score: 0, penalty: 22, label: 'missing_source_timestamp' }
  const ageHours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000))
  if (candidate.stale) return { score: 8, penalty: 24, label: 'stale_source_data' }
  if (ageHours <= 4) return { score: 18, penalty: 0, label: 'fresh_source_data' }
  if (ageHours <= 24) return { score: 12, penalty: 4, label: 'session_source_data' }
  if (ageHours <= 96) return { score: 7, penalty: 10, label: 'aging_source_data' }
  return { score: 3, penalty: 18, label: 'stale_or_old_source_data' }
}

function rankingTier(score, status = 'ranked') {
  if (status !== 'ranked') return 'rejected'
  if (score >= 75) return 'priority_review'
  if (score >= 60) return 'review'
  if (score >= 40) return 'watch'
  return 'limited'
}

export function buildOpportunityExplainability({ candidate, eligibility, ranking, aiSummary = {}, evaluation = {}, providerMetadata = {} } = {}) {
  const observedEvidence = [
    `Scanner score ${ranking?.componentContributions?.scannerScore?.value ?? candidate.scannerScore}.`,
    `Source data timestamp ${candidate.asOf}.`,
    candidate.liquiditySummary?.status ? `Liquidity status ${sanitizeAiText(candidate.liquiditySummary.status, 60)}.` : '',
    candidate.marketRegime?.regime ? `Market regime ${sanitizeAiText(candidate.marketRegime.regime, 60)}.` : '',
  ].filter(Boolean)
  const negative = Object.entries(ranking?.componentContributions ?? {})
    .filter(([, contribution]) => Number(contribution.value) < 0)
    .map(([key, contribution]) => `${key}: ${contribution.reason}`)
  const positive = Object.entries(ranking?.componentContributions ?? {})
    .filter(([, contribution]) => Number(contribution.value) > 0)
    .map(([key, contribution]) => `${key}: ${contribution.reason}`)
  const warnings = normalizeList(evaluation?.warnings ?? providerMetadata?.evaluationWarnings ?? [], 8)
  const missing = uniqueList([...(candidate.missingData ?? []), ...(aiSummary.missingEvidence ?? [])], 8)
  return {
    observedEvidence: observedEvidence.slice(0, 8),
    modelInterpretation: sanitizeAiText(aiSummary.reasoning ?? aiSummary.summary ?? candidate.thesis ?? 'No model interpretation was required for deterministic ranking.', 700),
    positiveContributors: positive.slice(0, 8),
    negativeContributors: negative.slice(0, 8),
    uncertaintyFactors: uniqueList([...(aiSummary.weaknesses ?? []), ...(aiSummary.risks ?? []), ...warnings], 8),
    staleOrMissingData: uniqueList([candidate.stale ? 'Source data is marked stale.' : '', ...missing], 8),
    evaluationWarnings: warnings,
    fallbackStatus: providerMetadata.fallbackUsed ? 'fallback_used' : (providerMetadata.degraded ? 'degraded' : 'primary_or_deterministic'),
    limitations: uniqueList([...(aiSummary.limitations ?? []), ...(eligibility?.reasonCodes ?? []), 'Ranking supports human paper-trading review only and is not an execution instruction.'], 8),
    rankingRationale: sanitizeAiText(`${ranking?.rankingTier ?? 'limited'} tier from deterministic score ${ranking?.rankingScore ?? 0}; score increases came from validated scanner, freshness, data quality, liquidity, and strategy compatibility inputs, while risks, stale data, missing data, degraded provider status, and evaluation warnings reduced the score.`, 900),
    versionMetadata: {
      rankingVersion: OPPORTUNITY_RANKING_VERSION,
      explainabilityVersion: OPPORTUNITY_EXPLAINABILITY_VERSION,
      analysisVersion: OPPORTUNITY_ANALYSIS_VERSION,
    },
    hiddenPromptsExposed: false,
    chainOfThoughtStored: false,
    rawProviderPayloadStored: false,
  }
}

export function rankOpportunityCandidate(input = {}, options = {}) {
  const candidate = normalizeOpportunityContract(input.opportunity ?? input.candidate ?? input)
  const eligibility = input.eligibility ?? evaluateOpportunityEligibility({ opportunity: candidate, config: options.aiConfig ?? options.config ?? {} })
  const evaluation = input.evaluation ?? options.evaluation ?? {}
  const providerMetadata = input.providerMetadata ?? options.providerMetadata ?? {}
  const rejected = eligibility.eligible === false || String(evaluation.overallStatus ?? '').toLowerCase() === 'rejected'
  const freshness = freshnessContribution(candidate)
  const missingPenalty = clampScore100((candidate.missingData?.length ?? 0) * 6, 0)
  const risk = riskPenalty(candidate.riskSummary)
  const liquidityStatus = String(candidate.liquiditySummary?.status ?? '').toLowerCase()
  const liquidity = liquidityStatus === 'healthy' ? 8 : liquidityStatus === 'adequate' ? 5 : liquidityStatus ? -8 : -4
  const dataQuality = String(candidate.dataQuality?.status ?? '').toLowerCase()
  const dataQualityScore = dataQuality === 'healthy' ? 9 : dataQuality === 'partial' ? 3 : dataQuality ? -7 : -5
  const strategy = ['qualified', 'compatible', 'approved_for_review'].includes(String(candidate.strategyQualification).toLowerCase()) ? 8 : -6
  const supportStrength = Math.min(10, normalizeList([candidate.signalSummary, ...(candidate.signalIds ?? [])], 10).length * 2)
  const invalidation = candidate.invalidationConditions.length ? 4 : -5
  const degradedPenalty = providerMetadata.degraded || providerMetadata.fallbackUsed ? 8 : 0
  const warningPenalty = Math.min(12, (evaluation.warnings?.length ?? providerMetadata.evaluationWarnings?.length ?? 0) * 3)
  const scanner = clampScore100(candidate.scannerScore, 0) * 0.34
  const baseScore = scanner + freshness.score + liquidity + dataQualityScore + strategy + supportStrength + invalidation
  const totalPenalty = risk + freshness.penalty + missingPenalty + degradedPenalty + warningPenalty
  const rankingScore = rejected ? 0 : clampScore100(baseScore - totalPenalty, 0)
  const rankingStatus = rejected ? 'rejected' : 'ranked'
  const ranking = {
    opportunityId: candidate.opportunityId,
    symbol: candidate.symbol,
    category: candidate.opportunityCategory,
    timeframe: candidate.timeframe,
    rankingScore,
    rankingTier: rankingTier(rankingScore, rankingStatus),
    rankingStatus,
    confidence: clampNumber(input.confidence ?? options.confidence ?? candidate.scannerScore / 100, 0.5, 0, 1),
    componentContributions: {
      scannerScore: { value: clampScore100(scanner), reason: 'Validated deterministic scanner score contribution.' },
      dataFreshness: { value: clampScore100(freshness.score - freshness.penalty), reason: freshness.label },
      supportingFactorStrength: { value: clampScore100(supportStrength), reason: 'Bounded signal summary and source identifiers.' },
      riskFactorSeverity: { value: -clampScore100(risk), reason: 'Validated risk summary penalty.' },
      invalidationClarity: { value: invalidation, reason: candidate.invalidationConditions.length ? 'Invalidation conditions provided.' : 'Missing invalidation conditions.' },
      liquidityQuality: { value: liquidity, reason: liquidityStatus || 'missing_liquidity_data' },
      strategyCompatibility: { value: strategy, reason: sanitizeAiText(candidate.strategyQualification, 80) },
      dataCompleteness: { value: clampScore100(dataQualityScore - missingPenalty), reason: candidate.missingData.length ? 'Missing data reduced the score.' : (dataQuality || 'data quality not provided') },
      providerFallbackOrDegraded: { value: -degradedPenalty, reason: providerMetadata.fallbackUsed ? 'Provider fallback was used.' : (providerMetadata.degraded ? 'AI assistance was degraded.' : 'No provider degradation penalty.') },
      evaluationWarnings: { value: -warningPenalty, reason: warningPenalty ? 'Evaluator warnings reduced the score.' : 'No evaluator warning penalty.' },
    },
    dataFreshness: { sourceDataTimestamp: candidate.asOf, stale: candidate.stale, label: freshness.label },
    evaluationStatus: evaluation.overallStatus ?? 'not_evaluated',
    evaluationWarnings: normalizeList(evaluation.warnings ?? providerMetadata.evaluationWarnings ?? [], 8),
    limitations: uniqueList([...(candidate.missingData.length ? ['Missing data reduces confidence.'] : []), ...(candidate.stale ? ['Stale data requires renewed review.'] : []), 'Ranking is advisory and paper-trading only.'], 8),
    rankingVersion: OPPORTUNITY_RANKING_VERSION,
    advisoryOnlyNotice: ATLAS_AI_NOTICE,
    paperTradingOnlyNotice: 'Paper trading only; no live orders or broker execution.',
    actionable: false,
  }
  return {
    ...ranking,
    explainability: buildOpportunityExplainability({
      candidate,
      eligibility,
      ranking,
      aiSummary: input.aiSummary ?? options.aiSummary ?? {},
      evaluation,
      providerMetadata,
    }),
  }
}

export function rankOpportunityCandidates(candidates = [], options = {}) {
  if (!Array.isArray(candidates)) invalidRequest('opportunity ranking input is invalid')
  return candidates
    .map((candidate) => rankOpportunityCandidate(candidate, options))
    .sort((left, right) => right.rankingScore - left.rankingScore || left.symbol.localeCompare(right.symbol))
    .map((entry, index) => ({ ...entry, deterministicRank: index + 1 }))
}

export function validateOpportunityReviewUpdate(input = {}) {
  const opportunityId = sanitizeAiText(input.opportunityId ?? input.id, 160)
  if (!opportunityId) invalidRequest('opportunity id is invalid')
  const reviewState = sanitizeAiText(input.reviewState ?? input.state, 40).toLowerCase()
  if (!OPPORTUNITY_REVIEW_STATES.includes(reviewState)) invalidRequest('opportunity review state is invalid', { reviewState })
  const feedback = input.feedback ? sanitizeAiText(input.feedback, 40).toLowerCase() : null
  if (feedback && !OPPORTUNITY_REVIEW_FEEDBACK.includes(feedback)) invalidRequest('opportunity review feedback is invalid', { feedback })
  const reviewNote = sanitizeAiText(input.reviewNote ?? input.note ?? '', 500)
  ensureSafeOpportunityText(reviewNote, 'review note')
  return {
    opportunityId,
    reviewState,
    feedback,
    reviewNote,
  }
}

export function validateOpportunityHistoryFilters(input = {}) {
  const limit = Number(input.limit ?? 25)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalidRequest('opportunity history limit is invalid', { limit: input.limit })
  const symbol = input.symbol ? sanitizeAiText(input.symbol, 20).toUpperCase() : null
  if (symbol && !isValidSymbol(symbol)) invalidRequest('opportunity symbol is invalid', { symbol })
  const category = input.category ?? input.analysisCategory
  const normalizedCategory = category ? normalizeAnalysisCategory(category) : null
  const timeframe = input.timeframe ? normalizeTimeframe(input.timeframe) : null
  const reviewState = input.reviewState ? sanitizeAiText(input.reviewState, 40).toLowerCase() : null
  if (reviewState && !OPPORTUNITY_REVIEW_STATES.includes(reviewState)) invalidRequest('opportunity review state is invalid', { reviewState })
  const rankingTierValue = input.rankingTier ? sanitizeAiText(input.rankingTier, 40).toLowerCase() : null
  if (rankingTierValue && !['priority_review', 'review', 'watch', 'limited', 'rejected'].includes(rankingTierValue)) invalidRequest('opportunity ranking tier is invalid', { rankingTier: rankingTierValue })
  const from = input.from ?? input.dateFrom
  const to = input.to ?? input.dateTo
  if (from && Number.isNaN(Date.parse(from))) invalidRequest('opportunity history date range is invalid', { from })
  if (to && Number.isNaN(Date.parse(to))) invalidRequest('opportunity history date range is invalid', { to })
  if (from && to && Date.parse(from) > Date.parse(to)) invalidRequest('opportunity history date range is invalid', { from, to })
  return { limit, symbol, category: normalizedCategory, timeframe, reviewState, rankingTier: rankingTierValue, from, to }
}

function sanitizeCandidateInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const safeFields = ['id', 'opportunityId', 'symbol', 'asOf', 'timestamp', 'category', 'opportunityCategory', 'direction', 'thesis', 'timeframe', 'invalidationConditions', 'scannerSource', 'scannerScore', 'signalIds', 'signalSummary', 'strategyId', 'strategyName', 'strategyQualification', 'deterministicMetrics', 'marketRegime', 'liquiditySummary', 'volatilitySummary', 'riskSummary', 'portfolioConflictSummary', 'historicalStrategySummary', 'dataQuality', 'missingData', 'stale', 'hardRejectionReasons']
  return safeFields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) next[field] = input[field]
    return next
  }, {})
}

function sanitizeOpportunityRankings(rankedOpportunities = [], baselineRanks = [], maxMovement = 1) {
  return rankedOpportunities.map((entry, index) => {
    const baselineRank = Number(baselineRanks[index] ?? entry.baselineRank ?? index + 1) || index + 1
    const advisoryRank = Number(entry.advisoryRank ?? index + 1) || index + 1
    if (Math.abs(advisoryRank - baselineRank) > maxMovement) {
      throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected' })
    }
    return {
      ...entry,
      baselineRank,
      advisoryRank,
    }
  })
}

export function normalizeOpportunityContract(input = {}) {
  const safeInput = sanitizeCandidateInput(input)
  const asOf = stableString(safeInput.asOf ?? safeInput.timestamp ?? nowIso(), nowIso())
  const opportunityId = stableString(safeInput.opportunityId ?? safeInput.id ?? `opportunity-${stableString(safeInput.symbol ?? 'UNKNOWN')}-${Date.parse(asOf) || Date.now()}`, 'opportunity-internal')
  const symbol = stableString(safeInput.symbol ?? 'UNKNOWN').toUpperCase()
  if (symbol !== 'UNKNOWN' && !isValidSymbol(symbol)) invalidRequest('opportunity symbol is invalid', { symbol })
  const timeframe = normalizeTimeframe(safeInput.timeframe ?? 'session')
  const opportunityCategory = sanitizeAiText(safeInput.opportunityCategory ?? safeInput.category ?? 'candidate_review', 80)
  const direction = sanitizeAiText(safeInput.direction ?? 'neutral', 40)
  const thesis = sanitizeAiText(safeInput.thesis ?? safeInput.signalSummary ?? '', 260)
  const invalidationConditions = uniqueList(safeInput.invalidationConditions ?? [], 6)
  const deterministicMetrics = normalizeObject(safeInput.deterministicMetrics ?? safeInput.metrics ?? {})
  const marketRegime = normalizeObject(safeInput.marketRegime ?? {})
  const liquiditySummary = normalizeObject(safeInput.liquiditySummary ?? {})
  const volatilitySummary = normalizeObject(safeInput.volatilitySummary ?? {})
  const riskSummary = normalizeObject(safeInput.riskSummary ?? {})
  const portfolioConflictSummary = normalizeObject(safeInput.portfolioConflictSummary ?? {})
  const historicalStrategySummary = normalizeObject(safeInput.historicalStrategySummary ?? {})
  const dataQuality = normalizeObject(safeInput.dataQuality ?? {})
  const missingData = normalizeList(safeInput.missingData ?? [], 6)
  const hardRejectionReasons = normalizeList(safeInput.hardRejectionReasons ?? [], 10)
  const signalIds = normalizeList(safeInput.signalIds ?? [], 6)
  const signalSummary = sanitizeAiText(safeInput.signalSummary ?? safeInput.signalsSummary ?? '', 420)
  const strategyQualification = stableString(safeInput.strategyQualification ?? safeInput.qualification ?? 'unknown')
  const scannerSource = stableString(safeInput.scannerSource ?? 'deterministic-scanner', 'deterministic-scanner')
  const scannerScore = clampNumber(safeInput.scannerScore, 0, 0, 100)
  const stale = safeInput.stale === true
  const contract = {
    opportunityId: opportunityId.slice(0, 220),
    symbol,
    asOf,
    scannerSource,
    scannerScore,
    opportunityCategory,
    direction,
    thesis,
    timeframe,
    invalidationConditions,
    signalIds,
    signalSummary,
    strategyId: stableString(safeInput.strategyId ?? safeInput.strategy ?? '', 'strategy-unknown').slice(0, 140),
    strategyName: stableString(safeInput.strategyName ?? safeInput.strategy ?? '', 'Strategy').slice(0, 180),
    strategyQualification,
    deterministicMetrics,
    marketRegime,
    liquiditySummary,
    volatilitySummary,
    riskSummary,
    portfolioConflictSummary,
    historicalStrategySummary,
    dataQuality,
    missingData,
    stale,
    hardRejectionReasons,
    sourceFingerprint: stableFingerprint({ opportunityId, symbol, asOf, scannerScore, strategyQualification, signalIds, marketRegime, liquiditySummary, riskSummary, portfolioConflictSummary, historicalStrategySummary }),
  }
  contract.redactedSummary = sanitizeAiText(JSON.stringify({ signalSummary, strategyName: contract.strategyName, scannerSource }), 420)
  return contract
}

export function evaluateOpportunityEligibility({ opportunity, config = {} } = {}) {
  const candidate = normalizeOpportunityContract(opportunity)
  const reasons = []
  const qualification = stableString(candidate.strategyQualification, 'unknown').toLowerCase()
  if (qualification === 'disqualified' || qualification === 'rejected' || qualification === 'blocked') {
    reasons.push('strategy_rejection')
  }
  if (candidate.riskSummary?.riskLevel === 'critical' || candidate.riskSummary?.score >= 80 || candidate.riskSummary?.severity === 'critical') {
    reasons.push('risk_rejection')
  }
  if (candidate.liquiditySummary?.status === 'thin' || candidate.liquiditySummary?.status === 'stressed' || candidate.liquiditySummary?.spreadPct > 0.25) {
    reasons.push('liquidity_rejection')
  }
  if (candidate.stale === true) {
    reasons.push('stale_data')
  }
  if (candidate.missingData.length > 0) {
    reasons.push('missing_data')
  }
  if (candidate.portfolioConflictSummary?.conflicts === true || candidate.portfolioConflictSummary?.status === 'conflict') {
    reasons.push('portfolio_conflict')
  }
  if (candidate.hardRejectionReasons.length > 0) {
    reasons.push(...candidate.hardRejectionReasons.slice(0, 4))
  }
  if (candidate.scannerScore < Number(config.minimumScannerScore ?? 50)) {
    reasons.push('scanner_score_below_threshold')
  }
  const deduped = Array.from(new Set(reasons)).slice(0, 8)
  const eligible = deduped.length === 0
  return {
    opportunity: candidate,
    eligible,
    reasonCodes: deduped,
    baselineRank: candidate.scannerScore,
  }
}

function buildContextCategories() {
  return ['opportunity_candidates', 'market_regime', 'risk_metrics', 'portfolio_summary', 'deterministic_context']
}

function buildAdvisoryPrompt(question, context, categories = []) {
  return {
    promptVersion: 'atlas-opportunity-analysis-v1',
    system: [
      'You are Atlas Copilot for Atlas Market.',
      'Use only deterministic Atlas opportunity context.',
      'Do not invent tradable signals or override hard rejections.',
      'Do not provide price targets, guarantees, or executable trading instructions.',
      'All analysis is advisory, paper-trading only, and not financial advice.',
    ].join('\n'),
    user: sanitizeAiText(question, 2600),
    context,
    outputSchema: {
      summary: 'string',
      strengths: 'string[]',
      weaknesses: 'string[]',
      risks: 'string[]',
      conflicts: 'string[]',
      missingEvidence: 'string[]',
      recommendation: 'strong_review|review|watch|avoid|insufficient_data',
      confidence: 'number 0..1',
      reasoning: 'string',
      limitations: 'string[]',
      advisoryOnly: true,
      paperTradingOnly: true,
    },
    contextCategories: categories,
  }
}

function sanitizeStructuredOutput(raw = {}, categories = [], { rankedCandidates = [], excludedCandidates = [], maxMovement = 1 } = {}) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const summary = String(raw.summary ?? '')
    const hasScript = /<script[\s\S]*?>|<[^>]+>/i.test(summary) || ['summary', 'reasoning', 'recommendation', 'limitations', 'strengths', 'weaknesses', 'risks', 'conflicts', 'missingEvidence'].some((key) => /<script[\s\S]*?>|<[^>]+>/i.test(String(raw[key] ?? '')))
    if (hasScript) throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected' })
    const unsafe = detectUnsafeOpportunityText(JSON.stringify(raw))
    if (unsafe) throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected', metadata: { unsafe } })
  }
  const sanitized = validateAtlasAiStructuredResponse(raw, categories)
  const recommendation = String(raw.recommendation ?? 'watch')
  const allowed = ['strong_review', 'review', 'watch', 'avoid', 'insufficient_data']
  const normalizedRecommendation = allowed.includes(recommendation) ? recommendation : 'watch'
  if (normalizedRecommendation === 'strong_review' && rankedCandidates.length === 0) throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected' })
  const rankingIds = new Set(rankedCandidates.map((entry) => entry.opportunityId))
  const excludedIds = new Set(excludedCandidates.map((entry) => entry.opportunityId))
  if (rankedCandidates.some((entry) => excludedIds.has(entry.opportunityId))) throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected' })
  if (sanitized.limitations.length === 0) throw new AppError('ai_response_rejected', 'AI response was rejected', { statusCode: 502, publicMessage: 'ai response rejected' })
  const sanitizedRanking = sanitizeOpportunityRankings(rankedCandidates, rankedCandidates.map((entry) => entry.baselineRank), maxMovement)
  return {
    ...sanitized,
    recommendation: normalizedRecommendation,
    confidence: clampNumber(sanitized.confidence, 0.5, 0, 1),
    limitations: (sanitized.limitations ?? []).slice(0, 6),
    strengths: (sanitized.strengths ?? []).slice(0, 6),
    weaknesses: (sanitized.weaknesses ?? []).slice(0, 6),
    risks: (sanitized.risks ?? []).slice(0, 6),
    conflicts: (sanitized.conflicts ?? []).slice(0, 6),
    missingEvidence: (sanitized.missingEvidence ?? []).slice(0, 6),
    reasoning: sanitizeAiText(raw.reasoning ?? sanitized.summary, 900),
    summary: sanitizeAiText(sanitized.summary, 700),
    advisoryOnly: true,
    paperTradingOnly: true,
    rankedCandidateIds: Array.from(rankingIds),
    sanitizedRanking,
  }
}

function createOpportunityDiagnosticsTracker(eventBus = defaultEventBus) {
  const state = {
    requestCount: 0,
    rankingSuccessCount: 0,
    noTradeRecommendationCount: 0,
    rejectedCandidateCount: 0,
    averageCandidateCount: 0,
    averageAnalysisLatencyMs: 0,
    invalidStructuredResponseCount: 0,
    staleMarketDataBlockCount: 0,
    deterministicHardRejectionCount: 0,
    lastSuccessfulRanking: null,
    lastFailedRanking: null,
  }
  const subscriptions = [
    [OPPORTUNITY_ANALYSIS_EVENTS.requested, () => {
      state.requestCount += 1
    }],
    [OPPORTUNITY_ANALYSIS_EVENTS.completed, (payload = {}) => {
      const candidateCount = Number(payload.candidateCount ?? payload.opportunityCount ?? 0) || 0
      state.rankingSuccessCount += 1
      state.averageCandidateCount = state.requestCount > 0 ? ((state.averageCandidateCount * (state.requestCount - 1)) + candidateCount) / state.requestCount : candidateCount
      state.averageAnalysisLatencyMs = state.rankingSuccessCount > 0 ? ((state.averageAnalysisLatencyMs * (state.rankingSuccessCount - 1)) + Number(payload.latencyMs ?? 0)) / state.rankingSuccessCount : Number(payload.latencyMs ?? 0)
      state.lastSuccessfulRanking = payload.timestamp ?? null
    }],
    [OPPORTUNITY_ANALYSIS_EVENTS.failed, (payload = {}) => {
      state.lastFailedRanking = payload.timestamp ?? null
      if (payload.reasonCode === 'invalid_structured_response') state.invalidStructuredResponseCount += 1
    }],
    [OPPORTUNITY_ANALYSIS_EVENTS.noTrade, () => { state.noTradeRecommendationCount += 1 }],
    [OPPORTUNITY_ANALYSIS_EVENTS.excluded, (payload = {}) => { state.rejectedCandidateCount += Number(payload.excludedCandidates?.length ?? 0) }],
    [OPPORTUNITY_ANALYSIS_EVENTS.staleBlocked, () => { state.staleMarketDataBlockCount += 1 }],
    [OPPORTUNITY_ANALYSIS_EVENTS.deterministicRejection, () => { state.deterministicHardRejectionCount += 1 }],
  ]
  const dispose = subscriptions.map(([event, handler]) => eventBus.subscribe?.(event, handler)).filter(Boolean)
  return {
    getSnapshot() {
      const successRate = state.requestCount > 0 ? state.rankingSuccessCount / state.requestCount : 0
      return { ...state, successRate }
    },
    reset() {
      Object.assign(state, {
        requestCount: 0,
        rankingSuccessCount: 0,
        noTradeRecommendationCount: 0,
        rejectedCandidateCount: 0,
        averageCandidateCount: 0,
        averageAnalysisLatencyMs: 0,
        invalidStructuredResponseCount: 0,
        staleMarketDataBlockCount: 0,
        deterministicHardRejectionCount: 0,
        lastSuccessfulRanking: null,
        lastFailedRanking: null,
      })
    },
    dispose() {
      dispose.forEach((unsubscribe) => unsubscribe())
    },
  }
}

const defaultOpportunityDiagnosticsTracker = createOpportunityDiagnosticsTracker(defaultEventBus)

export function getOpportunityAnalysisDiagnosticsSnapshot() {
  return defaultOpportunityDiagnosticsTracker.getSnapshot()
}

export function resetOpportunityAnalysisDiagnostics() {
  defaultOpportunityDiagnosticsTracker.reset()
}

export async function analyzeOpportunityIntelligence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const provider = options.provider ?? { generateStructured: async () => ({ summary: 'No analysis', recommendation: 'watch', confidence: 0.5, strengths: [], weaknesses: [], risks: [], conflicts: [], missingEvidence: [], reasoning: 'No analysis available.', limitations: ['Deterministic context only.'], advisoryOnly: true, paperTradingOnly: true }) }
  const tenantContext = input.tenantContext ?? input.tenantScope ?? {}
  const accountId = input.accountId ?? 'paper-portfolio'
  const config = {
    allowRankingReorder: options.aiConfig?.allowRankingReorder !== false,
    maxAdvisoryRankMovement: Number(options.aiConfig?.maxAdvisoryRankMovement ?? 1),
    maxCandidatesPerRequest: Number(options.aiConfig?.maxCandidatesPerRequest ?? 8),
    minimumScannerScore: Number(options.aiConfig?.minimumScannerScore ?? 50),
    ...options.aiConfig,
  }
  const request = validateOpportunityAnalysisRequest(input, config)
  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : []
  const boundedCandidates = rawCandidates.slice(0, Math.max(1, Math.min(20, request.limit, config.maxCandidatesPerRequest)))
  const normalizedCandidates = boundedCandidates.map((candidate) => normalizeOpportunityContract(candidate))
  const marketDataHealth = input.marketDataHealth ?? input.marketData ?? input.contextSources?.marketDataHealth ?? {}
  const degradedMarketData = ['degraded', 'critical', 'unhealthy'].includes(String(marketDataHealth.healthStatus ?? marketDataHealth.status ?? '').toLowerCase()) || marketDataHealth.degraded === true || marketDataHealth.stale === true
  const staleCandidates = normalizedCandidates.filter((candidate) => candidate.stale)
  const hardRejectedCandidates = normalizedCandidates.filter((candidate) => candidate.hardRejectionReasons.length > 0)
  if (staleCandidates.length > 0) eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.staleBlocked, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.staleBlocked, tenantContext, accountId, staleCandidateCount: staleCandidates.length, timestamp: nowIso() })
  if (hardRejectedCandidates.length > 0) eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.deterministicRejection, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.deterministicRejection, tenantContext, accountId, hardRejectedCandidateCount: hardRejectedCandidates.length, timestamp: nowIso() })
  const eligibleCandidates = normalizedCandidates.map((candidate) => ({
    ...evaluateOpportunityEligibility({ opportunity: candidate, config }),
    candidate,
  })).filter((entry) => entry.eligible)

  const deterministicRankings = rankOpportunityCandidates(eligibleCandidates.map((entry) => ({
    candidate: entry.candidate,
    eligibility: entry,
    providerMetadata: {
      degraded: input.providerHealth?.status === 'degraded' || input.providerHealth?.status === 'unhealthy',
      fallbackUsed: input.routingMetadata?.fallbackUsed === true,
      evaluationWarnings: input.evaluation?.warnings ?? [],
    },
    evaluation: input.evaluation ?? {},
  })), { aiConfig: config })
  const rankingById = new Map(deterministicRankings.map((ranking) => [ranking.opportunityId, ranking]))
  const rankedCandidates = eligibleCandidates
    .sort((left, right) => (rankingById.get(right.candidate.opportunityId)?.rankingScore ?? right.baselineRank) - (rankingById.get(left.candidate.opportunityId)?.rankingScore ?? left.baselineRank))
    .map((entry, index) => ({
      ...entry,
      ranking: rankingById.get(entry.candidate.opportunityId),
      baselineRank: index + 1,
      advisoryRank: config.allowRankingReorder === false ? index + 1 : Math.min(index + 1 + config.maxAdvisoryRankMovement, eligibleCandidates.length),
    }))

  const context = {
    opportunityCandidates: rankedCandidates.map((entry) => ({
      opportunityId: entry.candidate.opportunityId,
      symbol: entry.candidate.symbol,
      opportunityCategory: entry.candidate.opportunityCategory,
      direction: entry.candidate.direction,
      thesis: entry.candidate.thesis,
      timeframe: entry.candidate.timeframe,
      baselineRank: entry.baselineRank,
      scannerScore: entry.candidate.scannerScore,
      strategyQualification: entry.candidate.strategyQualification,
      marketRegime: entry.candidate.marketRegime,
      liquiditySummary: entry.candidate.liquiditySummary,
      riskSummary: entry.candidate.riskSummary,
      portfolioConflictSummary: entry.candidate.portfolioConflictSummary,
      missingData: entry.candidate.missingData,
      stale: entry.candidate.stale,
      sourceDataTimestamp: entry.candidate.asOf,
      hardRejectionReasons: entry.candidate.hardRejectionReasons,
    })),
    tenantContext,
    accountId,
    timeframe: request.timeframe,
  }
  const categories = buildContextCategories(input)
  const question = `Rank and explain eligible ${request.timeframe} opportunity candidates using deterministic Atlas context only. Keep advisory-only and paper-only boundaries.`
  const prompt = buildAdvisoryPrompt(question, context, categories)
  eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.requested, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.requested, tenantContext, accountId, requestCategory: input.requestCategory ?? 'opportunity_ranking', timestamp: nowIso() })
  let parsed
  try {
    const structured = await provider.generateStructured?.({ requestCategory: input.requestCategory ?? 'opportunity_ranking', question, prompt, contextCategories: categories })
    parsed = sanitizeStructuredOutput(structured ?? {}, categories, { rankedCandidates, excludedCandidates: [], maxMovement: config.maxAdvisoryRankMovement })
  } catch (error) {
    const reasonCode = error?.code === 'ai_response_rejected' ? 'invalid_structured_response' : 'provider_failed'
    eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.failed, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.failed, tenantContext, accountId, reasonCode, timestamp: nowIso() })
    throw error
  }
  const rankedOpportunities = rankedCandidates.map((entry, index) => {
    const deterministicRanking = rankOpportunityCandidate({
      candidate: entry.candidate,
      eligibility: entry,
      aiSummary: parsed,
      confidence: parsed.confidence,
      evaluation: input.evaluation ?? {},
      providerMetadata: {
        degraded: input.providerHealth?.status === 'degraded' || input.providerHealth?.status === 'unhealthy',
        fallbackUsed: input.routingMetadata?.fallbackUsed === true,
        evaluationWarnings: input.evaluation?.warnings ?? [],
      },
    }, { aiConfig: config })
    return {
      opportunityId: entry.candidate.opportunityId,
      symbol: entry.candidate.symbol,
      opportunityCategory: entry.candidate.opportunityCategory,
      category: entry.candidate.opportunityCategory,
      direction: entry.candidate.direction,
      thesis: entry.candidate.thesis || parsed.reasoning,
      timeframe: entry.candidate.timeframe,
      baselineRank: entry.baselineRank,
      advisoryRank: index + 1,
      deterministicRank: deterministicRanking.deterministicRank ?? index + 1,
      recommendation: parsed.recommendation,
      rankingScore: deterministicRanking.rankingScore,
      rankingTier: deterministicRanking.rankingTier,
      rankingStatus: deterministicRanking.rankingStatus,
      rankingVersion: deterministicRanking.rankingVersion,
      componentContributions: deterministicRanking.componentContributions,
      dataFreshness: deterministicRanking.dataFreshness,
      evaluationStatus: deterministicRanking.evaluationStatus,
      evaluationWarnings: deterministicRanking.evaluationWarnings,
      explainability: deterministicRanking.explainability,
      supportingFactors: parsed.strengths,
      riskFactors: parsed.risks,
      invalidationConditions: entry.candidate.invalidationConditions?.length ? entry.candidate.invalidationConditions : ['Reassess if deterministic Atlas risk, liquidity, or strategy qualification changes.'],
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      risks: parsed.risks,
      conflicts: parsed.conflicts,
      missingEvidence: parsed.missingEvidence,
      confidence: deterministicRanking.confidence,
      reasoning: parsed.reasoning,
      observedData: {
        scannerScore: entry.candidate.scannerScore,
        marketRegime: entry.candidate.marketRegime,
        liquiditySummary: entry.candidate.liquiditySummary,
        riskSummary: entry.candidate.riskSummary,
        sourceDataTimestamp: entry.candidate.asOf,
        stale: entry.candidate.stale,
      },
      modelInterpretation: sanitizeAiText(parsed.reasoning, 700),
      sourceDataTimestamp: entry.candidate.asOf,
      analysisVersion: OPPORTUNITY_ANALYSIS_VERSION,
      advisoryOnlyNotice: ATLAS_AI_NOTICE,
      paperTradingOnlyNotice: 'Paper trading only; no live orders or broker execution.',
      rankChangeExplanation: sanitizeAiText(`Deterministic rank ${index + 1} uses ranking version ${deterministicRanking.rankingVersion}; advisory rank remains bounded and does not authorize execution.`, 900),
      reviewPriority: deterministicRanking.rankingTier === 'priority_review' ? 'high' : 'medium',
      reviewState: 'new',
      actionable: false,
      liveOrders: false,
      brokerExecution: false,
    }
  })
  const excludedCandidates = normalizedCandidates.filter((candidate) => !eligibleCandidates.some((entry) => entry.candidate.opportunityId === candidate.opportunityId)).map((candidate) => ({
    opportunityId: candidate.opportunityId,
    symbol: candidate.symbol,
    reasonCodes: evaluateOpportunityEligibility({ opportunity: candidate, config }).reasonCodes,
  }))
  excludedCandidates.forEach((candidate) => {
    eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.excluded, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.excluded, tenantContext, accountId, excludedCandidate: candidate, timestamp: nowIso() })
  })
  const noTradeReasons = []
  if (rankedOpportunities.length === 0) noTradeReasons.push('no_eligible_candidates')
  if (staleCandidates.length > 0) noTradeReasons.push('stale_market_data')
  if (degradedMarketData) noTradeReasons.push('degraded_market_data_health')
  if (normalizedCandidates.some((candidate) => candidate.missingData.length > 0)) noTradeReasons.push('incomplete_context')
  if (normalizedCandidates.some((candidate) => candidate.riskSummary?.riskLevel === 'critical' || candidate.riskSummary?.score >= 80)) noTradeReasons.push('risk_capacity')
  const hasWeakEvidence = normalizedCandidates.some((candidate) => {
    const dataQualityStatus = String(candidate.dataQuality?.status ?? '').toLowerCase()
    const explicitWeakStatus = dataQualityStatus === 'weak' || dataQualityStatus === 'insufficient'
    const shortSignalSummary = Boolean(candidate.signalSummary) && candidate.signalSummary.length < 10
    return explicitWeakStatus || shortSignalSummary
  })
  if (hasWeakEvidence) noTradeReasons.push('weak_evidence')
  if (normalizedCandidates.some((candidate) => candidate.portfolioConflictSummary?.conflicts === true)) noTradeReasons.push('conflicting_signals')
  const noTradeRecommended = noTradeReasons.length > 0 || parsed.recommendation === 'insufficient_data' || parsed.recommendation === 'avoid'
  const result = {
    marketSummary: parsed.summary,
    marketRegime: normalizedCandidates[0]?.marketRegime?.regime ?? 'insufficient_data',
    rankedOpportunities: rankedOpportunities.slice(0, 8),
    excludedCandidates: excludedCandidates.slice(0, 8),
    noTradeRecommended,
    noTradeReasons: noTradeRecommended ? [parsed.reasoning || 'No eligible opportunities met the deterministic requirements.', ...noTradeReasons.slice(0, 4)] : [],
    limitations: parsed.limitations,
    contextCategories: categories,
    marketDataAsOf: normalizedCandidates[0]?.asOf ?? nowIso(),
    staleDataWarning: staleCandidates.length > 0 || degradedMarketData,
    generatedAt: nowIso(),
    analysisVersion: OPPORTUNITY_ANALYSIS_VERSION,
    timeframe: request.timeframe,
    analysisCategory: request.category,
    provider: options.provider?.provider ?? 'mock',
    model: options.provider?.model ?? 'atlas-mock-opportunity-v1',
    promptVersion: prompt.promptVersion,
    contextFingerprint: stableFingerprint({ categories, candidates: normalizedCandidates.map((candidate) => candidate.opportunityId) }),
    advisoryOnly: true,
    paperTradingOnly: true,
    advisoryOnlyNotice: ATLAS_AI_NOTICE,
    paperTradingOnlyNotice: 'Paper trading only; no live orders or broker execution.',
    rawProviderPayloadStored: false,
    chainOfThoughtStored: false,
    liveOrders: false,
    brokerExecution: false,
    tenantContext,
    accountId,
  }
  const completedPayload = { eventType: OPPORTUNITY_ANALYSIS_EVENTS.completed, tenantContext, accountId, opportunityCount: result.rankedOpportunities.length, noTradeRecommended, timestamp: nowIso(), latencyMs: 0 }
  eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.completed, completedPayload)
  if (result.noTradeRecommended) eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.noTrade, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.noTrade, tenantContext, accountId, timestamp: nowIso() })
  if (excludedCandidates.length > 0) eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.excluded, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.excluded, tenantContext, accountId, excludedCandidates, timestamp: nowIso() })
  eventBus?.emit?.(OPPORTUNITY_ANALYSIS_EVENTS.ranked, { eventType: OPPORTUNITY_ANALYSIS_EVENTS.ranked, tenantContext, accountId, rankedOpportunities: result.rankedOpportunities, timestamp: nowIso() })
  return result
}
