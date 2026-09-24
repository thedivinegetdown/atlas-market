import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_AI_TRADING_COPILOT_PORTFOLIO_INSIGHTS_GENERATED_EVENT = 'system.aiTradingCopilotPortfolioInsights.generated'
export const AI_TRADING_COPILOT_PORTFOLIO_INSIGHT_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function historicalPerformanceEvidence(backtestPerformance = {}) {
  const unavailable = [backtestPerformance.evidenceStatus, backtestPerformance.analyticsStatus]
    .some((status) => ['UNAVAILABLE', 'BLOCKED'].includes(String(status ?? '').toUpperCase()))
  if (unavailable) {
    return { status: 'UNAVAILABLE', score: null, contributed: false }
  }
  const profitFactor = finiteNumber(backtestPerformance.performanceSummary?.profitFactor ?? backtestPerformance.metrics?.profitFactor)
  if (profitFactor === null) return { status: 'NOT_PROVIDED', score: null, contributed: false }
  return { status: 'AVAILABLE', score: clampScore(Math.min(100, profitFactor * 40)), contributed: true }
}

function safeStatus(status) {
  return AI_TRADING_COPILOT_PORTFOLIO_INSIGHT_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeInsight(insight = {}) {
  return {
    id: String(insight.id ?? 'insight'),
    category: String(insight.category ?? 'portfolio').slice(0, 80),
    severity: String(insight.severity ?? 'medium').slice(0, 40),
    summary: String(insight.summary ?? 'Review portfolio context before manual paper-trading action.').slice(0, 240),
    score: clampScore(insight.score),
  }
}

export function normalizeAiTradingCopilotPortfolioInsightRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `ai-trading-copilot-portfolio-insight-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    insightStatus: safeStatus(input.insightStatus ?? input.status),
    insightScore: clampScore(input.insightScore),
    historicalEvidenceStatus: String(input.historicalEvidenceStatus ?? 'NOT_PROVIDED').toUpperCase(),
    historicalEvidenceScore: finiteNumber(input.historicalEvidenceScore),
    historicalEvidenceContributed: input.historicalEvidenceContributed === true,
    dominantStrategyBias: String(input.dominantStrategyBias ?? 'neutral').slice(0, 60),
    portfolioPosture: String(input.portfolioPosture ?? 'balanced').slice(0, 80),
    strategyComparisonSummary: String(input.strategyComparisonSummary ?? 'Strategy comparison prepared from existing signal, attribution, and backtest context.').slice(0, 700),
    portfolioInsightSummary: String(input.portfolioInsightSummary ?? input.insightSummary ?? 'Portfolio insight prepared for human review.').slice(0, 700),
    naturalLanguageResearchPrompts: (input.naturalLanguageResearchPrompts ?? []).slice(0, 5).map((prompt) => String(prompt).slice(0, 180)),
    insights: (input.insights ?? []).slice(0, 8).map(normalizeInsight),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createAiTradingCopilotPortfolioInsightRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const insight = normalizeAiTradingCopilotPortfolioInsightRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, insight }
      const result = await database.query(
        `INSERT INTO atlas_ai_trading_copilot_portfolio_insights
          (id, organization_id, team_workspace_id, insight_status, insight_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET insight_status = EXCLUDED.insight_status, insight_score = EXCLUDED.insight_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [insight.id, insight.tenantScope.organizationId, insight.tenantScope.teamWorkspaceId, insight.insightStatus, insight.insightScore, insight],
      )
      return { ok: true, insight: normalizeAiTradingCopilotPortfolioInsightRecord(result.rows?.[0]?.payload ?? insight) }
    },
    async list({ tenantContext = {}, insightStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (insightStatus) {
        params.push(safeStatus(insightStatus))
        clauses.push(`insight_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_ai_trading_copilot_portfolio_insights
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeAiTradingCopilotPortfolioInsightRecord(row.payload))
    },
  }
}

export function generateAiTradingCopilotPortfolioInsights(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.aiTradingCopilotPortfolioInsights ?? input.aiTradingCopilotPortfolioInsight ?? []
  const strategySignal = input.strategySignalComposition ?? input.strategySignal ?? {}
  const strategyAttribution = input.strategyAttribution ?? {}
  const backtestPerformance = input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
  const portfolioAnalytics = input.portfolioAnalytics ?? {}
  const portfolioOptimization = input.portfolioOptimization ?? {}
  const portfolioRisk = input.portfolioRisk ?? input.risk ?? {}
  const tradeSignalExplanation = input.aiTradingCopilotTradeSignalExplanation ?? {}
  const signalScore = clampScore(strategySignal.signalStrengthScore ?? strategySignal.confidenceScore)
  const diversificationScore = clampScore(portfolioAnalytics.diversification?.score ?? 75)
  const optimizationScore = clampScore(portfolioOptimization.optimizationConfidenceScore ?? 70)
  const riskScore = clampScore(100 - Number(portfolioRisk.summary?.riskScore ?? 25))
  const explanationScore = clampScore(tradeSignalExplanation.aiTradingCopilotTradeSignalExplanationSummary?.averageExplanationScore ?? signalScore)
  const historicalEvidence = historicalPerformanceEvidence(backtestPerformance)
  const scoreInputs = [signalScore, diversificationScore, optimizationScore, riskScore, explanationScore]
  if (historicalEvidence.contributed) scoreInputs.push(historicalEvidence.score)
  const score = Math.round(scoreInputs.reduce((sum, value) => sum + value, 0) / scoreInputs.length)
  const scoredStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const insightStatus = historicalEvidence.status === 'UNAVAILABLE' && scoredStatus === 'ready' ? 'caution' : scoredStatus
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const dominantStrategyBias = strategySignal.signalDirection ?? strategySignal.normalizedStrategySignal?.signalDirection ?? 'neutral'
  const historicalSummary = historicalEvidence.status === 'AVAILABLE'
    ? `backtest performance score ${historicalEvidence.score}`
    : historicalEvidence.status === 'UNAVAILABLE'
      ? 'historical backtest evidence is UNAVAILABLE and contributes no score'
      : 'historical backtest evidence was not supplied and contributes no score'
  const generatedInsight = normalizeAiTradingCopilotPortfolioInsightRecord({
    tenantContext,
    insightStatus,
    insightScore: score,
    historicalEvidenceStatus: historicalEvidence.status,
    historicalEvidenceScore: historicalEvidence.score,
    historicalEvidenceContributed: historicalEvidence.contributed,
    dominantStrategyBias,
    portfolioPosture: riskScore >= 80 && diversificationScore >= 75 ? 'constructive' : riskScore < 60 ? 'defensive review' : 'balanced review',
    strategyComparisonSummary: `Strategy context is ${dominantStrategyBias}; signal score ${signalScore}, ${historicalSummary}, and attribution source ${strategyAttribution.eventType ?? 'not supplied'} are summarized for comparison only.`,
    portfolioInsightSummary: `Portfolio insight is ${insightStatus}; diversification ${diversificationScore}, optimization confidence ${optimizationScore}, risk readiness ${riskScore}, and copilot explanation ${explanationScore} are ready for human review.`,
    naturalLanguageResearchPrompts: [
      'What portfolio exposures most affect this paper-trading setup?',
      'How does the current strategy signal compare with recent backtest context?',
      'Which research or risk detail should be reviewed before a manual paper action?',
      'What portfolio constraint could reduce confidence in this signal?',
    ],
    insights: [
      { id: 'strategy-bias', category: 'strategy comparison', severity: signalScore >= 75 ? 'low' : 'medium', summary: `Dominant strategy bias is ${dominantStrategyBias}.`, score: signalScore },
      { id: 'portfolio-diversification', category: 'portfolio insight', severity: diversificationScore >= 75 ? 'low' : 'medium', summary: `Diversification score is ${diversificationScore}.`, score: diversificationScore },
      { id: 'risk-readiness', category: 'portfolio risk', severity: riskScore >= 75 ? 'low' : 'high', summary: `Risk readiness score is ${riskScore}.`, score: riskScore },
      { id: 'optimization-context', category: 'optimization', severity: optimizationScore >= 75 ? 'low' : 'medium', summary: `Optimization confidence is ${optimizationScore}.`, score: optimizationScore },
    ],
    sourceReferences: [
      { id: 'strategy-signal', type: 'strategy-signal', eventType: strategySignal.eventType },
      { id: 'strategy-attribution', type: 'strategy-attribution', eventType: strategyAttribution.eventType },
      { id: 'backtest-performance', type: 'backtest-performance', eventType: backtestPerformance.eventType },
      { id: 'portfolio-analytics', type: 'portfolio-analytics', eventType: portfolioAnalytics.eventType },
      { id: 'portfolio-optimization', type: 'portfolio-optimization', eventType: portfolioOptimization.eventType },
      { id: 'portfolio-risk', type: 'portfolio-risk', eventType: portfolioRisk.eventType },
      { id: 'trade-signal-explanation', type: 'trade-signal-explanation', eventType: tradeSignalExplanation.eventType },
    ],
    timestamp: options.timestamp,
  })
  const insights = (sourceItems.length ? sourceItems : [generatedInsight]).map((item) => normalizeAiTradingCopilotPortfolioInsightRecord(
    historicalEvidence.status === 'UNAVAILABLE'
      ? {
          ...item,
          insightStatus: safeStatus(item.insightStatus) === 'ready' ? 'caution' : item.insightStatus,
          insightScore: score,
          historicalEvidenceStatus: 'UNAVAILABLE',
          historicalEvidenceScore: null,
          historicalEvidenceContributed: false,
          strategyComparisonSummary: `Strategy context is ${dominantStrategyBias}; signal score ${signalScore}, ${historicalSummary}, and attribution source ${strategyAttribution.eventType ?? 'not supplied'} are summarized for comparison only.`,
        }
      : item,
  ))
  const aiTradingCopilotPortfolioInsightSummary = {
    total: insights.length,
    ready: insights.filter((item) => item.insightStatus === 'ready').length,
    caution: insights.filter((item) => item.insightStatus === 'caution').length,
    blocked: insights.filter((item) => item.insightStatus === 'blocked').length,
    historicalEvidenceAvailable: insights.filter((item) => item.historicalEvidenceStatus === 'AVAILABLE').length,
    historicalEvidenceUnavailable: insights.filter((item) => item.historicalEvidenceStatus === 'UNAVAILABLE').length,
    historicalEvidenceContributions: insights.filter((item) => item.historicalEvidenceContributed).length,
    averageInsightScore: insights.length ? Math.round(insights.reduce((sum, item) => sum + item.insightScore, 0) / insights.length) : 0,
  }
  const aiTradingCopilotPortfolioInsightStatus = aiTradingCopilotPortfolioInsightSummary.blocked > 0 ? 'blocked' : aiTradingCopilotPortfolioInsightSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: SYSTEM_AI_TRADING_COPILOT_PORTFOLIO_INSIGHTS_GENERATED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    aiTradingCopilotPortfolioInsights: insights,
    aiTradingCopilotPortfolioInsightSummary,
    aiTradingCopilotPortfolioInsightStatus,
    advisoryOnly: true,
    humanReviewOnly: true,
    externalAiProvider: false,
    automaticOrderPlacement: false,
    automaticBrokerExecution: false,
    automaticDecisionOverride: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `AI trading copilot portfolio insights ${aiTradingCopilotPortfolioInsightStatus}: average insight score ${aiTradingCopilotPortfolioInsightSummary.averageInsightScore}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_AI_TRADING_COPILOT_PORTFOLIO_INSIGHTS_GENERATED_EVENT, result)
  return result
}
