import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function statusFrom(reconciliation, portfolio) {
  if (reconciliation?.reconciliationStatus === 'blocked' || portfolio?.streamingPortfolioStatus === 'blocked') return 'blocked'
  if (reconciliation?.reconciliationStatus === 'mismatch') return 'mismatch'
  if (portfolio?.streamingPortfolioStatus === 'stale') return 'stale'
  if (reconciliation?.reconciliationStatus === 'caution' || portfolio?.streamingPortfolioStatus === 'caution') return 'caution'
  return 'healthy'
}

export function createPortfolioReconciliationHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, tenantContext }) => {
    const latest = options.realtimePortfolioReconciliation?.realtimePortfolioReconciliations?.[0] ?? null
    const realtimePaperPortfolio = options.realtimePaperPortfolio
    const healthStatus = statusFrom(latest, realtimePaperPortfolio)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'portfolio-reconciliation-health', status: healthStatus }),
      tenantScope: { organizationId: tenantContext.organizationId, teamWorkspaceId: tenantContext.teamWorkspaceId },
      portfolioReconciliationHealth: {
        healthStatus,
        latestReconciliationStatus: latest?.reconciliationStatus ?? 'blocked',
        streamingPortfolioStatus: realtimePaperPortfolio?.streamingPortfolioStatus ?? 'blocked',
        duplicateFillProtection: latest?.duplicateFillProtection ?? { status: 'unknown', duplicateFillsSuppressed: 0 },
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      },
    }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'portfolio-reconciliation-health', ...options })
}

export const handler = createPortfolioReconciliationHealthHandler()
