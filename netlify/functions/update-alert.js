import { createApiHandler } from './_shared/api.js'

export const handler = createApiHandler(({ body, service }) => {
  return service.updateAlert(body.id, body)
}, { allowedMethods: ['POST'] })
