import { createWorkspaceDataService } from '../../../lib/workspace/workspaceDataService.js'
import { AppError, ERROR_CODES, isAppError, toPublicError } from '../../../lib/errors/appError.js'
import { serverLogger } from '../../../lib/logging/logger.js'
import { validateEnvironment } from '../../../lib/config/environment.js'
import { assertRateLimit, defaultRateLimiter } from '../../../lib/security/rateLimiter.js'
import {
  assertJsonMutationBody,
  assertRequestSize,
  assertSafePayload,
  getClientKey,
} from '../../../lib/security/requestGuards.js'
import { TRADING_EVENTS } from '../../../lib/observability/eventLogger.js'
import { createObservabilityRecord, normalizeErrorCategory } from '../../../lib/system/releaseObservabilityReadinessEngine.js'

export function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function getCorsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-request-id,x-csrf-token',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}

export function jsonResponse(statusCode, body, { requestId } = {}) {
  return {
    statusCode,
    headers: {
      ...getCorsHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: JSON.stringify(body),
  }
}

export function ok(data, options = {}) {
  return jsonResponse(200, {
    ok: true,
    data,
  }, options)
}

export function fail(statusCode, code, message, options = {}) {
  return jsonResponse(statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
  }, options)
}

export function optionsResponse({ requestId } = {}) {
  return {
    statusCode: 204,
    headers: {
      ...getCorsHeaders(),
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: '',
  }
}

export function getQuery(event) {
  return event?.queryStringParameters ?? {}
}

export function getJsonBody(event) {
  if (!event?.body) return {}

  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
  } catch {
    return null
  }
}

function normalizeMethod(event) {
  return String(event?.httpMethod ?? 'GET').toUpperCase()
}

export function assertMethod(event, allowedMethods) {
  const method = normalizeMethod(event)
  if (method === 'OPTIONS') return { ok: true, method }

  if (!allowedMethods.includes(method)) {
    throw new AppError(ERROR_CODES.METHOD_NOT_ALLOWED, `Method ${method} is not allowed`, {
      statusCode: 405,
      publicMessage: 'method is not allowed',
      metadata: { method, allowedMethods },
    })
  }

  return { ok: true, method }
}

export function createApiHandler(resolver, {
  serviceFactory = createWorkspaceDataService,
  allowedMethods = ['GET'],
  logger = serverLogger,
  env = process.env,
  rateLimiter = defaultRateLimiter,
  rateLimitKey = getClientKey,
  maxRequestBytes = 64 * 1024,
} = {}) {
  return async (event = {}) => {
    const headers = event.headers ?? {}
    const requestId = headers['x-request-id'] ?? headers['X-Request-Id'] ?? createRequestId()
    const startedAt = Date.now()

    try {
      validateEnvironment(env)
      const method = assertMethod(event, allowedMethods)
      if (method.method === 'OPTIONS') {
        return optionsResponse({ requestId })
      }

      assertRateLimit(rateLimiter, rateLimitKey(event))
      assertRequestSize(event, { maxBytes: maxRequestBytes })
      assertJsonMutationBody(event, method.method)
      const body = getJsonBody(event)
      if (body === null) {
        throw new AppError(ERROR_CODES.INVALID_JSON, 'Invalid JSON request body', {
          statusCode: 400,
          publicMessage: 'request body must be valid JSON',
        })
      }
      assertSafePayload(body)

      const data = await resolver({
        event,
        query: getQuery(event),
        body,
        requestId,
        service: serviceFactory(),
      })

      if (data?.ok === false && data?.error) {
        return fail(data.statusCode ?? 400, data.error.code, data.error.message, { requestId })
      }

      logger.info('workspace api request completed', createObservabilityRecord({
        eventType: 'api.request.completed',
        route: event.path ?? 'netlify-function',
        category: 'api',
        status: 'healthy',
        durationMs: Date.now() - startedAt,
        requestId,
      }))
      return ok(data, { requestId })
    } catch (error) {
      const publicError = toPublicError(error)
      logger.error('workspace api request failed', {
        ...createObservabilityRecord({
          eventType: TRADING_EVENTS.API_ERROR,
          route: event.path ?? 'netlify-function',
          category: normalizeErrorCategory(error),
          status: publicError.statusCode >= 500 ? 'unhealthy' : 'degraded',
          durationMs: Date.now() - startedAt,
          requestId,
          metadata: {
            code: publicError.code,
            statusCode: publicError.statusCode,
            appError: isAppError(error),
            safeMetadata: isAppError(error) ? error.metadata : {},
          },
        }),
      })
      return fail(publicError.statusCode, publicError.code, publicError.message, { requestId })
    }
  }
}
