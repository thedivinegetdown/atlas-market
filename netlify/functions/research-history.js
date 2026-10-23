import { createProvisionalResearchService } from '../../lib/research/provisionalResearchService.js'
import { requireSymbol } from '../../lib/workspace/validators.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

// One service instance retains the existing process-local raw provider cache, never tenant-derived evidence.
let service
export function createResearchHistoryHandler({ serviceFactory = () => (service ??= createProvisionalResearchService()), ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(({ query }) => {
    const allowed = ['symbol', 'skipQuote', 'organizationId']
    if (Object.keys(query).some((key) => !allowed.includes(key))) return { ok: false, statusCode: 400, error: { code: 'unsupported_research_parameters', message: 'custom research evidence is not accepted' } }
    const validation = requireSymbol(query.symbol)
    if (!validation.ok) return validation
    const skipQuote = query.skipQuote ?? 'false'
    if (!['true', 'false'].includes(skipQuote)) return { ok: false, statusCode: 400, error: { code: 'invalid_quote_mode', message: 'skipQuote is invalid' } }
    return serviceFactory().read(validation.symbol, { skipQuote: skipQuote === 'true' })
  }, { ...options, allowedMethods: ['GET'], requiredPermission: 'dashboard.read', routeId: 'research-history' })
}
export const handler = createResearchHistoryHandler()
