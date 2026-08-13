import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { loadDurablePaperProjection } from './_shared/durablePaperWorkspace.js'

export function createPaperWorkspaceProjectionHandler({ ledgerRepository, env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ query, tenantContext, user, repository }) => {
    const { projection } = await loadDurablePaperProjection({ accountId: query.accountId, tenantContext, user, repository, ledgerRepository, env, asOf: query.asOf })
    if (query.view !== 'journal') return projection

    const search = String(query.search ?? '').trim().toLowerCase()
    const symbol = String(query.symbol ?? 'all').toUpperCase()
    const result = String(query.result ?? 'all').toLowerCase()
    const entries = projection.journal.entries.filter((entry) => {
      if (symbol !== 'ALL' && entry.symbol !== symbol) return false
      if (result !== 'all' && entry.result !== result) return false
      return !search || `${entry.symbol} ${entry.strategy} ${entry.notes} ${entry.tags.join(' ')}`.toLowerCase().includes(search)
    })
    return { ...projection.journal, entries, canonicalDurableSource: true }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-workspace-projection', env, ...options })
}

export const handler = createPaperWorkspaceProjectionHandler()
