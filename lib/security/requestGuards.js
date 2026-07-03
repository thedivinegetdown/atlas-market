import { AppError } from '../errors/appError.js'

export const unsafePayloadKeys = Object.freeze(['__proto__', 'constructor', 'prototype'])

function getHeader(event, headerName) {
  const headers = event?.headers ?? {}
  const normalizedName = String(headerName).toLowerCase()
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)
  return match?.[1] ?? ''
}

export function getClientKey(event = {}) {
  return getHeader(event, 'x-forwarded-for').split(',')[0].trim()
    || getHeader(event, 'client-ip')
    || 'anonymous'
}

export function assertRequestSize(event = {}, { maxBytes = 64 * 1024 } = {}) {
  const body = event?.body ?? ''
  const byteLength = Buffer.byteLength(String(body), event.isBase64Encoded ? 'base64' : 'utf8')

  if (byteLength > maxBytes) {
    throw new AppError('request_too_large', 'Request body is too large', {
      statusCode: 413,
      publicMessage: 'request body is too large',
      metadata: {
        byteLength,
        maxBytes,
      },
    })
  }

  return { ok: true, byteLength }
}

export function assertJsonMutationBody(event = {}, method = 'GET') {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    return { ok: true }
  }

  const contentType = getHeader(event, 'content-type')
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new AppError('json_required', 'Mutation request body must be JSON', {
      statusCode: 415,
      publicMessage: 'mutation requests must use application/json',
      metadata: {
        contentType,
      },
    })
  }

  return { ok: true }
}

export function findUnsafeKey(value, path = []) {
  if (!value || typeof value !== 'object') return null

  for (const key of Object.keys(value)) {
    const nextPath = [...path, key]
    if (unsafePayloadKeys.includes(key)) {
      return nextPath.join('.')
    }

    const nested = findUnsafeKey(value[key], nextPath)
    if (nested) return nested
  }

  return null
}

export function assertSafePayload(value) {
  const unsafeKey = findUnsafeKey(value)
  if (unsafeKey) {
    throw new AppError('unsafe_payload_key', 'Unsafe payload key rejected', {
      statusCode: 400,
      publicMessage: 'request payload contains an unsafe key',
      metadata: {
        unsafeKey,
      },
    })
  }

  return { ok: true }
}
