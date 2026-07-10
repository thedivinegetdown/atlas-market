import { AppError, ERROR_CODES } from '../../../lib/errors/appError.js'
import { createLocalDevelopmentAuthAdapter, validateAuthenticatedSession } from '../../../lib/auth/authenticationProvider.js'
import { createAuthorizationService } from '../../../lib/auth/authorizationService.js'
import { createPersistenceApiHandler } from './persistenceApi.js'

function getHeader(headers = {}, name) {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}

export function extractBearerOrCookieToken(event = {}) {
  const headers = event.headers ?? {}
  const authorization = getHeader(headers, 'authorization')
  if (authorization?.match(/^Bearer\s+/i)) return authorization.replace(/^Bearer\s+/i, '').trim()
  const cookie = getHeader(headers, 'cookie') ?? ''
  const match = String(cookie).match(/atlas_session=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function assertOriginAllowed(event = {}, allowedOrigins = ['http://localhost:5173', 'http://localhost:8888']) {
  const origin = getHeader(event.headers ?? {}, 'origin')
  if (!origin) return true
  if (!allowedOrigins.includes(origin)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Origin is not allowed', {
      statusCode: 403,
      publicMessage: 'origin is not allowed',
      metadata: { originAllowed: false },
    })
  }
  return true
}

export function assertCsrfReady(event = {}) {
  const method = String(event.httpMethod ?? 'GET').toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true
  const token = getHeader(event.headers ?? {}, 'x-csrf-token')
  if (!token) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'CSRF token is required', {
      statusCode: 403,
      publicMessage: 'csrf token is required',
    })
  }
  return true
}

export function createAuthenticatedApiHandler(resolver, {
  requiredPermission = 'dashboard.read',
  authProvider = createLocalDevelopmentAuthAdapter(),
  authorizationService = createAuthorizationService(),
  allowedOrigins,
  ...options
} = {}) {
  return createPersistenceApiHandler(async (context) => {
    assertOriginAllowed(context.event, allowedOrigins)
    assertCsrfReady(context.event)
    const token = extractBearerOrCookieToken(context.event)
    if (!token) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Authentication is required', {
        statusCode: 401,
        publicMessage: 'authentication required',
      })
    }
    const authentication = await authProvider.authenticate({
      headers: context.event.headers ?? {},
      token,
    })
    const sessionValidation = validateAuthenticatedSession(authentication.session)
    if (!authentication.ok || !sessionValidation.valid) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, sessionValidation.reason, {
        statusCode: 401,
        publicMessage: 'authentication required',
      })
    }
    let authorization
    try {
      authorization = authorizationService.assert({
        user: authentication.user,
        session: authentication.session,
        permission: requiredPermission,
        requestId: context.requestId,
        routeId: options.routeId,
        workspaceId: context.body?.workspaceId ?? context.query?.workspaceId,
      })
    } catch (error) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message ?? 'Forbidden', {
        statusCode: 403,
        publicMessage: 'forbidden',
        metadata: { code: error?.code ?? 'forbidden' },
      })
    }
    return resolver({
      ...context,
      token,
      authentication,
      authorization,
      user: authentication.user,
      session: authentication.session,
    })
  }, options)
}
