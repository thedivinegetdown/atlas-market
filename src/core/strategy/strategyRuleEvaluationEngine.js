import { normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_RULES_EVALUATED_EVENT = 'strategy.rules.evaluated'

const allowedStatuses = Object.freeze(['pass', 'caution', 'fail'])

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
}

function normalizeTimeframe(value) {
  return normalizeText(value, 'swing').toLowerCase()
}

function normalizeSymbol(value) {
  return normalizeText(value, 'MARKET').toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getBlueprint(input = {}) {
  return input.strategyBlueprintValidation?.blueprint ?? input.blueprint ?? {}
}

function getBlueprintValidationStatus(input = {}) {
  return input.strategyBlueprintValidation?.validationStatus ?? input.validationStatus ?? 'caution'
}

function getResearchScore(input = {}) {
  return numberValue(
    input.researchDecisionContext?.researchScoreSummary?.finalResearchScore
      ?? input.researchSignalScore?.finalResearchScore,
    50,
  )
}

function getResearchBias(input = {}) {
  return input.researchDecisionContext?.decisionBiasSummary?.decisionBias
    ?? input.researchSignalScore?.decisionBias
    ?? 'neutral'
}

function getAiDecision(input = {}) {
  return input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.finalDecision
    ?? input.aiDecision?.finalDecision
    ?? 'watchlist'
}

function getRuleValue(condition = {}, input = {}) {
  switch (condition.type) {
    case 'market_regime':
      return input.marketRegime?.riskRegime?.regime
        ?? input.marketRegime?.compositeRegimeLabel
        ?? input.researchDecisionContext?.marketContextSummary?.marketRegime?.label
        ?? 'unknown'
    case 'research_score':
      return getResearchScore(input)
    case 'research_bias':
      return getResearchBias(input)
    case 'ai_decision':
      return getAiDecision(input)
    case 'price_action':
      return input.marketRegime?.trendRegime?.regime
        ?? input.researchDecisionContext?.marketContextSummary?.trend?.direction
        ?? 'sideways'
    case 'risk_state':
      return input.marketRegime?.riskRegime?.regime
        ?? input.researchDecisionContext?.marketContextSummary?.riskSentiment?.label
        ?? input.portfolioRisk?.summary?.riskLevel
        ?? 'unknown'
    case 'position_sizing':
      return input.positionSizing?.status ?? 'unknown'
    case 'timeframe_alignment':
      return input.multiTimeframeContext?.dominantTimeframeBias?.bias
        ?? input.multiTimeframeContext?.timeframeResearchScoreAlignment?.alignment
        ?? 'neutral'
    default:
      return undefined
  }
}

function valuesMatch(actual, expected) {
  const actualValue = Array.isArray(actual) ? actual.map(String) : String(actual)
  const expectedValue = Array.isArray(expected) ? expected.map(String) : String(expected)
  if (Array.isArray(actualValue) && Array.isArray(expectedValue)) {
    return actualValue.some((value) => expectedValue.includes(value))
  }
  if (Array.isArray(actualValue)) return actualValue.includes(expectedValue)
  if (Array.isArray(expectedValue)) return expectedValue.includes(actualValue)
  return actualValue === expectedValue
}

function compareValues(operator, actual, expected) {
  const normalizedOperator = normalizeText(operator, 'eq').toLowerCase()
  const actualNumber = numberValue(actual)
  const expectedNumber = numberValue(expected)

  if (['gt', 'gte', 'lt', 'lte'].includes(normalizedOperator)) {
    if (actualNumber === null || expectedNumber === null) return null
    if (normalizedOperator === 'gt') return actualNumber > expectedNumber
    if (normalizedOperator === 'gte') return actualNumber >= expectedNumber
    if (normalizedOperator === 'lt') return actualNumber < expectedNumber
    return actualNumber <= expectedNumber
  }

  if (normalizedOperator === 'eq') return valuesMatch(actual, expected)
  if (normalizedOperator === 'neq') return !valuesMatch(actual, expected)
  if (normalizedOperator === 'in') return valuesMatch(actual, expected)
  if (normalizedOperator === 'not_in') return !valuesMatch(actual, expected)
  if (normalizedOperator === 'exists') return actual !== null && actual !== undefined && actual !== ''
  return null
}

function evaluateCondition(condition = {}, input = {}, side = 'entry') {
  const actualValue = getRuleValue(condition, input)
  const comparison = compareValues(condition.operator, actualValue, condition.value)
  const status = comparison === true ? 'pass' : comparison === false ? 'fail' : 'caution'

  return {
    id: condition.id,
    type: condition.type,
    side,
    status,
    operator: condition.operator,
    expectedValue: condition.value,
    actualValue,
    source: condition.source,
    description: condition.description,
    rationale: status === 'pass'
      ? `${condition.id} passed against ${condition.source}.`
      : status === 'fail'
        ? `${condition.id} failed against ${condition.source}.`
        : `${condition.id} requires operator or context review.`,
  }
}

function summarizeRuleResults(rules = [], label) {
  const passed = rules.filter((rule) => rule.status === 'pass').length
  const failed = rules.filter((rule) => rule.status === 'fail').length
  const cautions = rules.filter((rule) => rule.status === 'caution').length
  const status = failed > 0 ? 'fail' : cautions > 0 ? 'caution' : 'pass'

  return {
    label,
    status,
    passed,
    failed,
    cautions,
    total: rules.length,
    rules,
  }
}

function evaluateRiskRule(rule = {}, input = {}) {
  const referencedEvents = [
    input.portfolioRisk?.eventType,
    input.positionSizing?.eventType,
    input.tradeGuardrail?.eventType,
    input.aiDecision?.eventType,
    input.researchEnhancedDecision?.eventType,
    input.marketRegime?.eventType,
  ].filter(Boolean)
  const hasReference = Boolean(rule.reference)
  const hasRuntimeContext = hasReference && referencedEvents.includes(rule.reference)
  const status = hasRuntimeContext ? 'pass' : rule.required ? 'fail' : 'caution'

  return {
    id: rule.id,
    engine: rule.engine,
    reference: rule.reference,
    required: rule.required !== false,
    status,
    rationale: status === 'pass'
      ? `${rule.id} is backed by a current paper-trading context event.`
      : status === 'fail'
        ? `${rule.id} is required but no current context event matched ${rule.reference ?? 'the reference'}.`
        : `${rule.id} is optional and should be reviewed before paper deployment.`,
  }
}

function evaluateCompatibility({ supported = [], actual, label }) {
  const normalizedSupported = supported.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
  const normalizedActual = normalizeText(actual).toLowerCase()
  const compatible = normalizedSupported.includes(normalizedActual)

  return {
    label,
    status: compatible ? 'pass' : 'fail',
    actual,
    supported,
    rationale: compatible
      ? `${actual} is compatible with this blueprint.`
      : `${actual} is outside the blueprint compatibility list.`,
  }
}

function collectBlockers({ blueprintValidationStatus, entryRuleEvaluation, riskRuleEvaluation, timeframeCompatibility, assetClassCompatibility }) {
  const blockers = []
  if (blueprintValidationStatus === 'invalid') blockers.push('Strategy blueprint validation is invalid')
  if (entryRuleEvaluation.status === 'fail') blockers.push('One or more entry rules failed')
  if (riskRuleEvaluation.status === 'fail') blockers.push('One or more required risk rules failed')
  if (timeframeCompatibility.status === 'fail') blockers.push('Timeframe is not compatible with the blueprint')
  if (assetClassCompatibility.status === 'fail') blockers.push('Asset class is not compatible with the blueprint')
  return blockers
}

function collectCautions({ blueprintValidationStatus, entryRuleEvaluation, exitRuleEvaluation, riskRuleEvaluation }) {
  const cautions = []
  if (blueprintValidationStatus === 'caution') cautions.push('Strategy blueprint validation has cautions')
  if (entryRuleEvaluation.status === 'caution') cautions.push('One or more entry rules require review')
  if (exitRuleEvaluation.status === 'pass') cautions.push('One or more exit rules are active')
  if (exitRuleEvaluation.status === 'caution') cautions.push('One or more exit rules require review')
  if (riskRuleEvaluation.status === 'caution') cautions.push('One or more risk rules require review')
  return cautions
}

export function evaluateStrategyRules(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const blueprint = getBlueprint(input)
  const symbol = normalizeSymbol(input.symbol ?? input.researchDecisionContext?.symbol ?? input.marketRegime?.symbol)
  const assetType = normalizeAssetType(input.assetType ?? input.researchDecisionContext?.assetType ?? input.marketRegime?.assetType ?? 'equity')
  const timeframe = normalizeTimeframe(input.timeframe ?? input.multiTimeframeContext?.dominantTimeframeBias?.dominantBucket)
  const blueprintValidationStatus = getBlueprintValidationStatus(input)

  const entryRules = (blueprint.entryConditions ?? []).map((condition) => evaluateCondition(condition, input, 'entry'))
  const exitRules = (blueprint.exitConditions ?? []).map((condition) => evaluateCondition(condition, input, 'exit'))
  const riskRules = (blueprint.riskRuleReferences ?? []).map((rule) => evaluateRiskRule(rule, input))
  const entryRuleEvaluation = summarizeRuleResults(entryRules, 'Entry Rules')
  const exitRuleEvaluation = summarizeRuleResults(exitRules, 'Exit Rules')
  const riskRuleEvaluation = summarizeRuleResults(riskRules, 'Risk Rules')
  const timeframeCompatibility = evaluateCompatibility({
    supported: blueprint.timeframeReferences ?? [],
    actual: timeframe,
    label: 'Timeframe Compatibility',
  })
  const assetClassCompatibility = evaluateCompatibility({
    supported: blueprint.compatibleAssetClasses ?? [],
    actual: assetType,
    label: 'Asset Compatibility',
  })
  const blockers = collectBlockers({
    blueprintValidationStatus,
    entryRuleEvaluation,
    riskRuleEvaluation,
    timeframeCompatibility,
    assetClassCompatibility,
  })
  const cautions = collectCautions({
    blueprintValidationStatus,
    entryRuleEvaluation,
    exitRuleEvaluation,
    riskRuleEvaluation,
  })
  const strategyEvaluationStatus = blockers.length > 0 ? 'blocked' : cautions.length > 0 ? 'watchlist' : 'eligible'

  const result = {
    eventType: STRATEGY_RULES_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    strategyId: blueprint.id ?? 'strategy-blueprint',
    strategyName: blueprint.name ?? 'Untitled Strategy Blueprint',
    symbol,
    assetType,
    timeframe,
    blueprintValidationStatus,
    entryRuleEvaluation,
    exitRuleEvaluation,
    riskRuleEvaluation,
    timeframeCompatibility,
    assetClassCompatibility,
    strategyEvaluationStatus,
    blockers,
    cautions,
    summary: `${blueprint.name ?? 'Strategy blueprint'} rule evaluation is ${strategyEvaluationStatus} for paper trading.`,
    sourceEvents: {
      strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
      researchDecisionContext: input.researchDecisionContext?.eventType ?? null,
      researchSignalScore: input.researchSignalScore?.eventType ?? null,
      marketRegime: input.marketRegime?.eventType ?? null,
      aiDecision: input.researchEnhancedDecision?.eventType ?? input.aiDecision?.eventType ?? null,
      tradeGuardrail: input.tradeGuardrail?.eventType ?? null,
      portfolioRisk: input.portfolioRisk?.eventType ?? null,
      positionSizing: input.positionSizing?.eventType ?? null,
      multiTimeframeContext: input.multiTimeframeContext?.eventType ?? null,
    },
  }

  if (!allowedStatuses.includes(entryRuleEvaluation.status)) {
    result.cautions.push('Entry rule evaluation produced an unknown status')
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_RULES_EVALUATED_EVENT, result)
  }

  return result
}

export function createStrategyRuleEvaluationEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateStrategyRules(input, { ...options, ...evaluationOptions })
    },
  }
}
