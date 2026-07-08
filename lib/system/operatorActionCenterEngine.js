import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT = 'system.operatorActions.generated'

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function makeAction({ id, category, severity = 'medium', title, rationale, sourceReferences = [], status = 'open' }) {
  return {
    id,
    category,
    severity,
    title,
    rationale,
    sourceReferences: sourceReferences.filter(Boolean),
    status,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    humanReviewOnly: true,
  }
}

function getSystemHealth(input = {}) {
  return input.systemHealthCommandCenter ?? input.systemHealth ?? {}
}

function getEventObservability(input = {}) {
  return input.eventObservability ?? {}
}

function getOptimizationGovernance(input = {}) {
  return input.portfolioOptimizationGovernance ?? input.optimizationGovernance ?? {}
}

function getDrawdownProtection(input = {}) {
  return input.drawdownProtection ?? {}
}

function getPortfolioRisk(input = {}) {
  return input.portfolioRisk ?? input.risk ?? {}
}

function getReleaseReadiness(input = {}) {
  return input.releaseReadiness ?? {}
}

function getAdapterHealth(input = {}) {
  return {
    marketDataAdapterHealth: input.marketDataAdapterHealth ?? {},
    brokerAdapterHealth: input.brokerAdapterHealth ?? {},
  }
}

function buildSystemHealthActions(systemHealth = {}) {
  const actions = []
  if (systemHealth.finalPlatformHealthStatus === 'degraded') {
    actions.push(makeAction({
      id: 'system-health-investigate-degraded-platform',
      category: 'investigate',
      severity: 'critical',
      title: 'Investigate degraded platform health',
      rationale: systemHealth.summary ?? 'System Health Command Center reports degraded platform health.',
      sourceReferences: [systemHealth.eventType],
    }))
  } else if (systemHealth.finalPlatformHealthStatus === 'caution') {
    actions.push(makeAction({
      id: 'system-health-review-caution-stacks',
      category: 'review',
      severity: 'medium',
      title: 'Review cautionary system health stacks',
      rationale: systemHealth.summary ?? 'System Health Command Center reports cautionary stack health.',
      sourceReferences: [systemHealth.eventType],
    }))
  } else if (systemHealth.finalPlatformHealthStatus === 'operational') {
    actions.push(makeAction({
      id: 'system-health-approve-operational-posture',
      category: 'approve',
      severity: 'low',
      title: 'Acknowledge operational platform posture',
      rationale: systemHealth.summary ?? 'Platform health is operational across reviewed modules.',
      sourceReferences: [systemHealth.eventType],
    }))
  }

  const degradedModules = (systemHealth.moduleHealthRegistry ?? []).filter((module) => module.healthStatus === 'degraded')
  const cautionModules = (systemHealth.moduleHealthRegistry ?? []).filter((module) => module.healthStatus === 'caution')
  if (degradedModules.length > 0) {
    actions.push(makeAction({
      id: 'system-health-investigate-degraded-modules',
      category: 'investigate',
      severity: 'high',
      title: 'Investigate degraded module health',
      rationale: `${degradedModules.length} module(s) are degraded: ${degradedModules.slice(0, 3).map((module) => module.name).join(', ')}.`,
      sourceReferences: degradedModules.map((module) => module.eventType),
    }))
  }
  if (cautionModules.length > 0) {
    actions.push(makeAction({
      id: 'system-health-monitor-caution-modules',
      category: 'monitor',
      severity: 'medium',
      title: 'Monitor cautionary module health',
      rationale: `${cautionModules.length} module(s) require monitoring: ${cautionModules.slice(0, 3).map((module) => module.name).join(', ')}.`,
      sourceReferences: cautionModules.map((module) => module.eventType),
    }))
  }

  return actions
}

function buildEventObservabilityActions(eventObservability = {}) {
  const actions = []
  if (eventObservability.observabilityStatus === 'degraded') {
    actions.push(makeAction({
      id: 'events-investigate-degraded-observability',
      category: 'investigate',
      severity: 'high',
      title: 'Investigate degraded event observability',
      rationale: eventObservability.summary ?? 'Event observability is degraded.',
      sourceReferences: [eventObservability.eventType],
    }))
  } else if (eventObservability.observabilityStatus === 'caution') {
    actions.push(makeAction({
      id: 'events-review-observability-caution',
      category: 'review',
      severity: 'medium',
      title: 'Review event observability cautions',
      rationale: eventObservability.summary ?? 'Event observability has cautionary findings.',
      sourceReferences: [eventObservability.eventType],
    }))
  }

  if (numberValue(eventObservability.missingEventDetection?.missingCount) > 0) {
    actions.push(makeAction({
      id: 'events-investigate-missing-contracts',
      category: 'investigate',
      severity: 'high',
      title: 'Investigate missing event contracts',
      rationale: `${eventObservability.missingEventDetection.missingCount} required event contract(s) are missing.`,
      sourceReferences: [eventObservability.eventType],
    }))
  }
  if (numberValue(eventObservability.duplicateEventDetection?.duplicateCount) > 0) {
    actions.push(makeAction({
      id: 'events-monitor-duplicate-contracts',
      category: 'monitor',
      severity: 'medium',
      title: 'Monitor duplicate event observations',
      rationale: `${eventObservability.duplicateEventDetection.duplicateCount} duplicate event contract(s) were observed.`,
      sourceReferences: [eventObservability.eventType],
    }))
  }

  return actions
}

function buildGovernanceActions(governance = {}) {
  if (governance.governanceStatus === 'rejected') {
    return [makeAction({
      id: 'optimization-pause-rejected-governance',
      category: 'pause',
      severity: 'critical',
      title: 'Pause optimization influence after rejected governance review',
      rationale: governance.summary ?? 'Optimization governance rejected the recommendation package.',
      sourceReferences: [governance.eventType],
    })]
  }

  if (governance.governanceStatus === 'caution') {
    return [makeAction({
      id: 'optimization-review-caution-governance',
      category: 'review',
      severity: 'high',
      title: 'Review optimization governance cautions',
      rationale: governance.operatorActionClassification?.rationale ?? governance.summary ?? 'Optimization governance requires operator review.',
      sourceReferences: [governance.eventType],
    })]
  }

  if (governance.governanceStatus === 'approved') {
    return [makeAction({
      id: 'optimization-approve-reviewed-recommendations',
      category: 'approve',
      severity: 'low',
      title: 'Acknowledge approved optimization governance',
      rationale: governance.summary ?? 'Optimization governance approved paper-only recommendations.',
      sourceReferences: [governance.eventType],
    })]
  }

  return []
}

function buildRiskActions({ drawdownProtection = {}, portfolioRisk = {} }) {
  const actions = []
  if (drawdownProtection.protectionStatus === 'locked') {
    actions.push(makeAction({
      id: 'risk-pause-drawdown-lock',
      category: 'pause',
      severity: 'critical',
      title: 'Pause paper trading after drawdown protection lock',
      rationale: `Drawdown protection is locked with recommended action: ${drawdownProtection.recommendedAction}.`,
      sourceReferences: [drawdownProtection.eventType],
    }))
  } else if (drawdownProtection.protectionStatus === 'caution') {
    actions.push(makeAction({
      id: 'risk-reduce-drawdown-caution',
      category: 'reduce risk',
      severity: 'high',
      title: 'Reduce paper risk after drawdown caution',
      rationale: `Current drawdown is ${numberValue(drawdownProtection.currentDrawdown)}% against a ${numberValue(drawdownProtection.maxDrawdownThreshold)}% threshold.`,
      sourceReferences: [drawdownProtection.eventType],
    }))
  }

  const riskLevel = portfolioRisk.summary?.riskLevel
  if (riskLevel === 'critical') {
    actions.push(makeAction({
      id: 'risk-pause-critical-portfolio-risk',
      category: 'pause',
      severity: 'critical',
      title: 'Pause new paper risk after critical portfolio risk',
      rationale: `Portfolio risk score is ${numberValue(portfolioRisk.summary?.riskScore)} with ${numberValue(portfolioRisk.summary?.grossExposure)}% gross exposure.`,
      sourceReferences: [portfolioRisk.eventType],
    }))
  } else if (riskLevel === 'high' || riskLevel === 'elevated') {
    actions.push(makeAction({
      id: 'risk-reduce-elevated-portfolio-risk',
      category: 'reduce risk',
      severity: riskLevel === 'high' ? 'high' : 'medium',
      title: 'Reduce paper portfolio risk exposure',
      rationale: `Portfolio risk level is ${riskLevel}; review concentration, leverage, and open risk before new paper positions.`,
      sourceReferences: [portfolioRisk.eventType],
    }))
  }

  return actions
}

function buildAdapterAndReleaseActions({ marketDataAdapterHealth = {}, brokerAdapterHealth = {}, releaseReadiness = {} }) {
  const actions = []
  if (marketDataAdapterHealth.health?.status !== 'healthy') {
    actions.push(makeAction({
      id: 'adapter-investigate-market-data-health',
      category: 'investigate',
      severity: 'medium',
      title: 'Investigate market data adapter health',
      rationale: `Market data adapter status is ${marketDataAdapterHealth.health?.status ?? 'unknown'}.`,
      sourceReferences: [marketDataAdapterHealth.eventType],
    }))
  }
  if (brokerAdapterHealth.health?.liveOrders === true || brokerAdapterHealth.health?.paperTrading === false) {
    actions.push(makeAction({
      id: 'adapter-pause-unsafe-broker-mode',
      category: 'pause',
      severity: 'critical',
      title: 'Pause broker-dependent actions until paper mode is restored',
      rationale: 'Broker adapter is not confirmed paper-only or live orders appear enabled.',
      sourceReferences: [brokerAdapterHealth.eventType],
    }))
  } else if (brokerAdapterHealth.health?.status !== 'healthy') {
    actions.push(makeAction({
      id: 'adapter-investigate-broker-health',
      category: 'investigate',
      severity: 'medium',
      title: 'Investigate broker adapter health',
      rationale: `Broker adapter status is ${brokerAdapterHealth.health?.status ?? 'unknown'}.`,
      sourceReferences: [brokerAdapterHealth.eventType],
    }))
  }
  if (releaseReadiness.releaseReadinessStatus === 'blocked') {
    actions.push(makeAction({
      id: 'release-pause-blocked-readiness',
      category: 'pause',
      severity: 'critical',
      title: 'Pause release actions until readiness blockers clear',
      rationale: releaseReadiness.summary ?? 'Release readiness is blocked.',
      sourceReferences: [releaseReadiness.eventType],
    }))
  } else if (releaseReadiness.releaseReadinessStatus === 'caution') {
    actions.push(makeAction({
      id: 'release-review-readiness-cautions',
      category: 'review',
      severity: 'medium',
      title: 'Review release readiness cautions',
      rationale: releaseReadiness.summary ?? 'Release readiness has cautionary findings.',
      sourceReferences: [releaseReadiness.eventType],
    }))
  }

  return actions
}

function severityRank(severity) {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  }[severity] ?? 0
}

function summarizeActions(actions = []) {
  const categories = ['review', 'monitor', 'reduce risk', 'pause', 'approve', 'investigate']
  const severities = ['low', 'medium', 'high', 'critical']
  return {
    totalActions: actions.length,
    openActions: actions.filter((action) => action.status === 'open').length,
    byCategory: Object.fromEntries(categories.map((category) => [category, actions.filter((action) => action.category === category).length])),
    bySeverity: Object.fromEntries(severities.map((severity) => [severity, actions.filter((action) => action.severity === severity).length])),
    topSeverity: actions[0]?.severity ?? 'low',
    humanReviewOnly: true,
    paperTrading: true,
  }
}

export function generateOperatorActions(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const systemHealthCommandCenter = getSystemHealth(input)
  const eventObservability = getEventObservability(input)
  const portfolioOptimizationGovernance = getOptimizationGovernance(input)
  const drawdownProtection = getDrawdownProtection(input)
  const portfolioRisk = getPortfolioRisk(input)
  const releaseReadiness = getReleaseReadiness(input)
  const adapterHealth = getAdapterHealth(input)
  const prioritizedOperatorActions = [
    ...buildSystemHealthActions(systemHealthCommandCenter),
    ...buildEventObservabilityActions(eventObservability),
    ...buildGovernanceActions(portfolioOptimizationGovernance),
    ...buildRiskActions({ drawdownProtection, portfolioRisk }),
    ...buildAdapterAndReleaseActions({ ...adapterHealth, releaseReadiness }),
  ]
    .filter((action, index, actions) => actions.findIndex((candidate) => candidate.id === action.id) === index)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.category.localeCompare(right.category))

  const platformActionSummary = summarizeActions(prioritizedOperatorActions)
  const result = {
    eventType: SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    humanReviewOnly: true,
    timestamp,
    prioritizedOperatorActions,
    platformActionSummary,
    summary: `Operator Action Center generated ${platformActionSummary.totalActions} human-review paper actions; top severity is ${platformActionSummary.topSeverity}.`,
    sourceEvents: {
      systemHealthCommandCenter: systemHealthCommandCenter.eventType ?? null,
      eventObservability: eventObservability.eventType ?? null,
      portfolioOptimizationGovernance: portfolioOptimizationGovernance.eventType ?? null,
      drawdownProtection: drawdownProtection.eventType ?? null,
      portfolioRisk: portfolioRisk.eventType ?? null,
      marketDataAdapter: adapterHealth.marketDataAdapterHealth.eventType ?? null,
      brokerAdapter: adapterHealth.brokerAdapterHealth.eventType ?? null,
      releaseReadiness: releaseReadiness.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(SYSTEM_OPERATOR_ACTIONS_GENERATED_EVENT, result)
  }

  return result
}

export function createOperatorActionCenterEngine(options = {}) {
  return {
    generate(input, generationOptions = {}) {
      return generateOperatorActions(input, { ...options, ...generationOptions })
    },
  }
}
