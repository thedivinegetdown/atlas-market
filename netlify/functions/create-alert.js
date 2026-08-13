import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service }) => {
  return service.createAlert(body)
}, { allowedMethods: ['POST'], mutation: true, routeId: 'create-alert' })
