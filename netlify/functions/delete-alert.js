import { createProtectedWorkspaceApiHandler } from './_shared/protectedWorkspaceApi.js'

export const handler = createProtectedWorkspaceApiHandler(({ body, service }) => {
  return service.deleteAlert(body.id)
}, { allowedMethods: ['POST'], mutation: true, routeId: 'delete-alert' })
