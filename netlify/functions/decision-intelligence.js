import { buildDecisionIntelligence } from '../../lib/intelligence/decisionIntelligenceOrchestrator.js'
import { createMarketContextService } from '../../lib/market/context/marketContextEngine.js'
import { createMarketDataService } from '../../lib/market/marketDataService.js'
import { resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createDecisionIntelligenceHandler({ evidenceRepository: providedEvidenceRepository, ledgerRepository: providedLedgerRepository, marketContextService: providedMarketContextService, observationStatusResolver, env = process.env, ...options } = {}) {
  const marketContextService = providedMarketContextService ?? createMarketContextService({ marketDataService: createMarketDataService({ finnhubApiKey: env.FINNHUB_API_KEY, twelveDataApiKey: env.TWELVEDATA_API_KEY }) })
  return createOrganizationAuthenticatedApiHandler(async ({ query, tenantContext, user, repository, requestId }) => {
    const accountId = requireAccountContext(query.accountId ?? 'paper-portfolio')
    const scope = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const evidenceRepository = providedEvidenceRepository ?? resolveCanonicalPaperEvidenceRepository({ persistenceRepository: repository, env })
    const ledgerRepository = resolveCanonicalPaperLedgerRepository({ persistenceRepository: repository, ledgerRepository: providedLedgerRepository, env })
    const marketContext = await marketContextService.refresh()
    const intelligence = await buildDecisionIntelligence({ ...scope, selectedPlanId: query.planId ?? null, evidenceRepository, ledgerRepository, marketContext, observationStatusResolver })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'decision-intelligence', status: intelligence.market.status }),
      decisionIntelligence: intelligence,
      diagnostics: { qualifiedReturned: intelligence.opportunities.topQualifiedPlans.length, watchReturned: intelligence.opportunities.watchPlans.length, unavailableComponents: Object.values(intelligence.evidence.availability).filter((value) => value === 'UNAVAILABLE').length, bounded: true },
      advisoryOnly: true,
      paperTradingOnly: true,
      liveExecutionDisabled: true,
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'decision-intelligence', env, ...options })
}

export const handler = createDecisionIntelligenceHandler()