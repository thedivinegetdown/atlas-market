import { createApiHandler } from './_shared/api.js'

export const handler = createApiHandler(({ body, service, requestId }) => {
  return service.cancelPaperOrder(body.orderId, { requestId })
}, { allowedMethods: ['POST'] })
