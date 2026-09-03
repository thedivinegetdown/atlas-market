import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { runForwardObservation } from '../../lib/opportunities/forwardTest/forwardObservationOrchestrator.js'
import { resolveCanonicalPaperEvidenceRepository } from '../../lib/opportunities/persistence/canonicalPaperEvidenceRepository.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

const ALLOWED_FIELDS = new Set(['organizationId', 'workspaceId', 'accountId'])

function assertWriteAccess(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Forward observation access denied', { statusCode: 403, publicMessage: 'forward observation access denied' })
}

export function createForwardObservationHandler({ evidenceRepository: providedEvidenceRepository, ledgerRepository: providedLedgerRepository, clock = () => new Date().toISOString(), env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ body, tenantContext, user, membership, repository: persistenceRepository }) => {
    assertWriteAccess(membership)
    const unsupported = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field))
    if (unsupported) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Caller-supplied observation state is prohibited', { statusCode: 400, publicMessage: 'custom observation inputs are not supported' })
    const accountId = requireAccountContext(body.accountId ?? 'paper-portfolio')
    const scope = { tenantContext, accountId, userId: tenantContext.userId ?? user.id }
    const evidenceRepository = resolveCanonicalPaperEvidenceRepository({ opportunityRepository: providedEvidenceRepository, persistenceRepository, env })
    const ledgerRepository = resolveCanonicalPaperLedgerRepository({ persistenceRepository, ledgerRepository: providedLedgerRepository, env })
    return runForwardObservation({ ...scope, evidenceRepository, ledgerRepository, now: clock() })
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'forward-observation', maxRequestBytes: 4 * 1024, env, ...options })
}

export const handler = createForwardObservationHandler()
