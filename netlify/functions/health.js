import { createApiHandler } from './_shared/api.js'
import { createReadinessService } from '../../lib/observability/readiness.js'

export const handler = createApiHandler(({ requestId }) => {
  return createReadinessService().check({ requestId })
})
