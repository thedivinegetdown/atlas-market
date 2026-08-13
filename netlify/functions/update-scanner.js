import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service }) => {
  return service.updateScanner(body.id, body)
}, { allowedMethods: ['POST'], mutation: true, routeId: 'update-scanner' })
