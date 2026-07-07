import { normalizeAssetType, SUPPORTED_ASSET_TYPES } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_BLUEPRINT_VALIDATED_EVENT = 'strategy.blueprint.validated'

const allowedConditionTypes = Object.freeze([
  'market_regime',
  'research_score',
  'research_bias',
  'ai_decision',
  'price_action',
  'risk_state',
  'position_sizing',
  'timeframe_alignment',
])

const allowedTimeframes = Object.freeze(['intraday', 'swing', 'position'])

function normalizeId(value, fallback) {
  return String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
}

function normalizeText(value, fallback) {
  return String(value ?? fallback).trim() || fallback
}

function normalizeCondition(condition = {}, index, side) {
  return {
    id: normalizeId(condition.id, `${side}-condition-${index + 1}`),
    type: normalizeText(condition.type, 'research_score'),
    operator: normalizeText(condition.operator, 'gte'),
    value: condition.value ?? null,
    source: normalizeText(condition.source, 'strategy-builder'),
    description: normalizeText(condition.description, `${side} condition ${index + 1}`),
  }
}

function normalizeRiskRuleReference(rule = {}, index) {
  return {
    id: normalizeId(rule.id, `risk-rule-${index + 1}`),
    engine: normalizeText(rule.engine, 'tradeGuardrailEngine'),
    reference: normalizeText(rule.reference, rule.id ?? `risk-rule-${index + 1}`),
    required: rule.required !== false,
  }
}

function normalizeBlueprint(input = {}) {
  const metadataInput = input.metadata ?? {}
  const compatibleAssetClasses = Array.isArray(input.compatibleAssetClasses ?? input.assetClassCompatibility)
    ? (input.compatibleAssetClasses ?? input.assetClassCompatibility).map(normalizeAssetType)
    : [normalizeAssetType(input.assetType ?? 'equity')]
  const timeframeReferences = Array.isArray(input.timeframeReferences ?? input.timeframes)
    ? (input.timeframeReferences ?? input.timeframes).map((timeframe) => normalizeText(timeframe, 'swing').toLowerCase())
    : ['swing']

  return {
    id: normalizeId(input.id ?? metadataInput.id, 'strategy-blueprint'),
    name: normalizeText(input.name ?? metadataInput.name, 'Untitled Strategy Blueprint'),
    version: normalizeText(input.version ?? metadataInput.version, '0.1.0'),
    paperTrading: true,
    metadata: {
      owner: normalizeText(metadataInput.owner, 'Atlas Research'),
      description: normalizeText(metadataInput.description ?? input.description, 'Paper-only reusable strategy blueprint'),
      tags: Array.isArray(metadataInput.tags) ? metadataInput.tags.map((tag) => normalizeText(tag, 'tag')) : [],
      createdBy: normalizeText(metadataInput.createdBy, 'strategy-builder'),
    },
    entryConditions: (input.entryConditions ?? []).map((condition, index) => normalizeCondition(condition, index, 'entry')),
    exitConditions: (input.exitConditions ?? []).map((condition, index) => normalizeCondition(condition, index, 'exit')),
    riskRuleReferences: (input.riskRuleReferences ?? input.riskRules ?? []).map(normalizeRiskRuleReference),
    timeframeReferences,
    compatibleAssetClasses: [...new Set(compatibleAssetClasses)],
    references: {
      aiDecisionEvent: input.aiDecision?.eventType ?? null,
      researchEvent: input.researchEnhancedDecision?.eventType ?? input.researchDecisionContext?.eventType ?? null,
      marketRegimeEvent: input.marketRegime?.eventType ?? null,
      portfolioRiskEvent: input.portfolioRisk?.eventType ?? null,
      positionSizingEvent: input.positionSizing?.eventType ?? null,
    },
  }
}

function validateConditions(conditions, side) {
  const blockers = []
  const cautions = []

  if (conditions.length === 0) {
    blockers.push(`${side} conditions are required`)
  }

  conditions.forEach((condition) => {
    if (!allowedConditionTypes.includes(condition.type)) {
      blockers.push(`${side} condition ${condition.id} uses unsupported type ${condition.type}`)
    }
    if (condition.value === null || condition.value === undefined || condition.value === '') {
      cautions.push(`${side} condition ${condition.id} has no comparison value`)
    }
  })

  return { blockers, cautions }
}

function validateBlueprint(blueprint) {
  const blockers = []
  const cautions = []
  const entryValidation = validateConditions(blueprint.entryConditions, 'entry')
  const exitValidation = validateConditions(blueprint.exitConditions, 'exit')

  blockers.push(...entryValidation.blockers, ...exitValidation.blockers)
  cautions.push(...entryValidation.cautions, ...exitValidation.cautions)

  if (blueprint.compatibleAssetClasses.length === 0) {
    blockers.push('At least one compatible asset class is required')
  }
  if (blueprint.compatibleAssetClasses.some((assetType) => !SUPPORTED_ASSET_TYPES.includes(assetType))) {
    blockers.push('Unsupported asset class compatibility detected')
  }
  if (blueprint.timeframeReferences.length === 0) {
    blockers.push('At least one timeframe reference is required')
  }
  if (blueprint.timeframeReferences.some((timeframe) => !allowedTimeframes.includes(timeframe))) {
    blockers.push('Unsupported timeframe reference detected')
  }
  if (blueprint.riskRuleReferences.length === 0) {
    cautions.push('No risk rule references supplied')
  }
  if (!blueprint.references.aiDecisionEvent) {
    cautions.push('AI decision output is not referenced')
  }
  if (!blueprint.references.researchEvent) {
    cautions.push('Research decision context is not referenced')
  }
  if (!blueprint.references.marketRegimeEvent) {
    cautions.push('Market regime output is not referenced')
  }
  if (!blueprint.references.portfolioRiskEvent) {
    cautions.push('Portfolio risk output is not referenced')
  }
  if (!blueprint.references.positionSizingEvent) {
    cautions.push('Position sizing output is not referenced')
  }

  return {
    validationStatus: blockers.length > 0 ? 'invalid' : cautions.length > 0 ? 'caution' : 'valid',
    blockers,
    cautions,
  }
}

export function validateStrategyBlueprint(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const blueprint = normalizeBlueprint(input)
  const validation = validateBlueprint(blueprint)
  const result = {
    eventType: STRATEGY_BLUEPRINT_VALIDATED_EVENT,
    paperTrading: true,
    timestamp,
    blueprint,
    validationStatus: validation.validationStatus,
    blockers: validation.blockers,
    cautions: validation.cautions,
    summary: `${blueprint.name} strategy blueprint is ${validation.validationStatus} for paper trading reuse.`,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_BLUEPRINT_VALIDATED_EVENT, result)
  }

  return result
}

export function createStrategyBuilderEngine(options = {}) {
  return {
    validate(input, validationOptions = {}) {
      return validateStrategyBlueprint(input, { ...options, ...validationOptions })
    },
  }
}
