import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service, requestId }) => {
  return service.cancelPaperOrder(body.orderId, { requestId })
}, { allowedMethods: ['POST'], mutation: true, routeId: 'cancel-paper-order' })
