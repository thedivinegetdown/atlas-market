import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createUserProfileRepository, updateUserAccount } from '../../lib/auth/userAccountService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createAccountProfileUpdateHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user, body, repository }) => {
    try {
      const result = await updateUserAccount({
        actorUserId: user.id,
        targetUserId: body.userId ?? user.id,
        profile: {
          ...body.profile,
          userId: body.userId ?? user.id,
        },
      }, {
        repository: options.profileRepository ?? createUserProfileRepository(options),
        emitEvent: false,
      })
      await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.accountUpdateAuditRecord.id, result.accountUpdateAuditRecord)
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'account-profile-update', status: result.status }),
        result,
        passwordsStored: false,
        rawTokensStored: false,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      }
    } catch (error) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message, {
        statusCode: error.statusCode ?? 400,
        publicMessage: error.statusCode === 403 ? 'profile update denied' : 'profile is invalid',
      })
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    routeId: 'account-profile-update',
    ...options,
  })
}

export const handler = createAccountProfileUpdateHandler()
