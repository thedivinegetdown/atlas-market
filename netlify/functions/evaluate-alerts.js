import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service }) => {
  return service.evaluateAlerts(body)
}, { allowedMethods: ['POST'], mutation: true, routeId: 'evaluate-alerts' })
