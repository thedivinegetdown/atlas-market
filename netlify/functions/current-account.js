import { createUserProfileRepository } from '../../lib/auth/userAccountService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCurrentAccountHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const repository = options.profileRepository ?? createUserProfileRepository(options)
    const profile = await repository.getProfile?.(user.id)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'current-account' }),
      account: {
        userId: user.id,
        provider: user.provider,
        providerSubject: user.providerSubject,
        role: user.role,
        profile,
      },
      passwordsStored: false,
      rawTokensStored: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'current-account',
    ...options,
  })
}

export const handler = createCurrentAccountHandler()
