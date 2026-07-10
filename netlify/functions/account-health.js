import { createUserProfileRepository, validateUserProfile } from '../../lib/auth/userAccountService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createAccountHealthHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const repository = options.profileRepository ?? createUserProfileRepository(options)
    const profile = await repository.getProfile?.(user.id)
    const validation = validateUserProfile(profile)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'account-health', status: validation.valid ? 'healthy' : 'blocked' }),
      accountStatusSummary: {
        status: validation.valid ? 'healthy' : 'blocked',
        issues: validation.issues,
        providerSubjectPreserved: true,
        passwordsStored: false,
        rawTokensStored: false,
      },
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'account-health',
    ...options,
  })
}

export const handler = createAccountHealthHandler()
