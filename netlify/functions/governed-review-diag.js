import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { serverLogger } from '../../../lib/logging/logger.js'

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user } = context
  const repository = context.repository

  try {
    const store = repository.getStore('governedReviewPreparations')
    
    if (!store) {
      return {
        ok: false,
        error: { code: 'store_unavailable', message: 'governedReviewPreparations store not available' },
      }
    }

    // Try to list to verify table exists
    const records = await store.listScoped({ organizationId, userId: user.id, limit: 1 })
    
    return {
      ok: true,
      data: {
        storeAvailable: true,
        tableExists: true,
        recordCount: records.length,
        schemaVersion: '202609110001',
      },
    }
  } catch (err) {
    serverLogger.error('governed review diag error', { 
      organizationId, 
      userId: user.id, 
      error: err?.message,
      stack: err?.stack,
      code: err?.code
    })
    return {
      ok: false,
      error: { 
        message: 'Diagnostic failed', 
        details: err?.message ?? 'Unknown error',
        code: err?.code
      },
    }
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-diag',
})