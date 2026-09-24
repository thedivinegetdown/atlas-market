import { createHash } from 'node:crypto'
import { buildDecisionIntelligence } from '../intelligence/decisionIntelligenceOrchestrator.js'
import { resolveCanonicalPaperEvidenceRepository } from '../opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../opportunities/persistence/canonicalPaperLedgerRepository.js'

export const GROUNDING_VERSION = 'atlas-server-grounding-v1'
export const FACT_CLASSES = Object.freeze({ server: 'AUTHORITATIVE_SERVER_FACT', derived: 'DERIVED_DETERMINISTIC_FACT', user: 'USER_ADVISORY_INPUT', model: 'MODEL_GENERATED' })
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value))
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Only server dependencies enter this function. No request body/context spreading.
export async function loadAtlasGrounding({ tenantContext, accountId, repository, evidenceRepository, ledgerRepository, env = process.env, generatedAt = new Date().toISOString() }) {
  if (!tenantContext?.organizationId || !tenantContext?.userId || !accountId) throw new Error('Grounding requires authenticated scope')
  const scope = { tenantContext, accountId, userId: tenantContext.userId }
  const read = async (fn) => {
    let timer
    try { return await Promise.race([Promise.resolve().then(fn), new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1500) })]) }
    catch { return null }
    finally { clearTimeout(timer) }
  }
  const evidence = await read(async () => resolveCanonicalPaperEvidenceRepository({ opportunityRepository: evidenceRepository, persistenceRepository: repository, env }))
  const ledger = await read(async () => resolveCanonicalPaperLedgerRepository({ persistenceRepository: repository, ledgerRepository, env }))
  const [loadedEvaluations, snapshot, history] = await Promise.all([
    read(() => evidence?.listPaperEvaluations?.({ ...scope, limit: 20 })),
    read(() => ledger?.readAccountSnapshot?.(scope)),
    read(() => ledger?.readExecutionHistory?.({ ...scope, limit: 500 })),
  ])
  const evaluations = Array.isArray(loadedEvaluations) ? loadedEvaluations.slice(0, 20) : null
  // The facade deliberately exposes only reads. It cannot create accounts or execute.
  const intelligence = await buildDecisionIntelligence({
    ...scope, generatedAt, evaluations: evaluations ?? [],
    ledgerRepository: {
      getOrCreateAccount: async () => snapshot ?? { account: null, positions: null },
      readExecutionHistory: async () => history ?? { executions: [], history: { status: 'UNAVAILABLE', latest: null } },
    },
    observationStatuses: [],
  })
  return buildAtlasGrounding({ scope, intelligence, evaluations, snapshot, history, generatedAt })
}

export function buildAtlasGrounding({ scope, intelligence = {}, evaluations, snapshot, history, generatedAt }) {
  const facts = []
  const add = (id, value, source, classification = FACT_CLASSES.derived, available = value != null, reason = 'SOURCE_UNAVAILABLE') => {
    facts.push({ id, classification, source, status: available ? 'AVAILABLE' : 'UNAVAILABLE', value: available ? copy(value) : null, reason: available ? null : reason })
  }
  const context = intelligence.copilotContext ?? {}
  add('prices', evaluations?.length ? evaluations.map((entry) => ({
    symbol: entry.symbol ?? null, evaluationId: entry.evaluationId ?? null,
    quotedReferencePrice: entry.orderContext?.price ?? entry.orderContext?.referencePrice ?? entry.orderContext?.entryPrice ?? null,
    provenance: entry.marketData ?? null, freshness: entry.freshness ?? 'UNAVAILABLE',
    asOf: entry.evaluatedAt ?? null, evidenceFingerprint: entry.evidenceFingerprint ?? null,
    currentQuoteStatus: 'UNAVAILABLE',
  })) : null, 'canonicalPaperEvidence.listPaperEvaluations/orderContext; persisted reference prices, not current quotes', FACT_CLASSES.server)
  add('regime', evaluations?.length ? evaluations.map((entry) => ({ evaluationId: entry.evaluationId, regime: entry.regime ?? 'UNAVAILABLE', asOf: entry.evaluatedAt ?? null })) : null, 'canonicalPaperEvidence.listPaperEvaluations/regime')
  add('strategy', { registry: context.strategyRegistry, assessments: intelligence.strategyAssessments, evaluationAvailability: evaluations?.length ? 'AVAILABLE' : 'UNAVAILABLE' }, 'buildDecisionIntelligence/strategyRegistry+strategyAssessments')
  add('tq', evaluations?.length ? evaluations.map((entry) => ({ evaluationId: entry.evaluationId, score: entry.tradeQuality?.score ?? null, band: entry.tradeQuality?.band ?? 'UNAVAILABLE', asOf: entry.evaluatedAt ?? null })) : null, 'canonicalPaperEvidence.listPaperEvaluations/tradeQuality')
  add('risk', evaluations?.length ? { admission: context.portfolioAdmission, evaluations: evaluations.map((entry) => ({ evaluationId: entry.evaluationId, riskSafety: entry.riskSafety ?? { status: 'UNAVAILABLE' }, decisionStatus: entry.status ?? 'UNAVAILABLE', asOf: entry.evaluatedAt ?? null })), currentAdmission: 'UNAVAILABLE' } : null, 'canonical persisted evaluation risk + deterministic portfolio admission; no current re-admission')
  add('portfolio', snapshot?.account ? {
    cash: snapshot.account.cash, persistedEquity: snapshot.account.equity, realizedPnl: snapshot.account.realizedPnl,
    revision: snapshot.account.revision, asOf: snapshot.account.updatedAt, openPositionCount: snapshot.positions?.length ?? null,
    currentValuation: 'UNAVAILABLE',
  } : null, 'canonicalPaperLedger.readAccountSnapshot; persisted accounting, not fresh marked valuation', FACT_CLASSES.server)
  add('outcomes', history ? intelligence.decisionQuality : null, 'canonicalPaperOutcomes -> decisionQualityMonitor; descriptive only')
  add('samples', history ? { completedOutcomes: intelligence.decisionQuality?.overall?.completedOutcomes ?? null, cohorts: intelligence.decisionQuality?.groupings ?? null, history: history.history } : null, 'canonicalPaperOutcomes -> decisionQualityMonitor/cohorts; bounded history')
  add('historical', null, 'historical validation capability; no qualified positive evidence supplied', FACT_CLASSES.server, false, 'POSITIVE_HISTORICAL_CAPABILITY_NOT_ESTABLISHED')
  add('empiricalConfidence', null, 'Gap 7 boundary; INTEL.6 excluded', FACT_CLASSES.server, false, 'UNAVAILABLE')
  const envelope = { version: GROUNDING_VERSION, scope: { organizationId: scope.tenantContext.organizationId, userId: scope.tenantContext.userId, teamWorkspaceId: scope.tenantContext.teamWorkspaceId ?? null, accountId: scope.accountId }, generatedAt, facts, boundaries: { paperOnly: true, humanReviewRequired: true, executionActionsExposed: false, liveExecutionDisabled: true } }
  return freeze({ ...envelope, fingerprint: digest(envelope) })
}
