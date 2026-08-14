import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError } from '../errors/appError.js'

const VERSION = 'v1'
const DEFAULT_TTL_MS = 10 * 60 * 1000
const MAX_TOKEN_LENGTH = 2_048

function csrfError(code, message) {
  return new AppError(code, message, {
    statusCode: 403,
    publicMessage: code === 'csrf_required' ? 'csrf token is required' : code === 'csrf_expired' ? 'csrf token has expired' : 'csrf token is invalid',
    metadata: { csrfDenied: true },
  })
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function signingKey({ bearerToken, session }) {
  return createHmac('sha256', String(bearerToken)).update(`atlas-csrf:${session.tokenHash}:${session.id}`).digest()
}

function signature(payload, context) {
  return createHmac('sha256', signingKey(context)).update(`${VERSION}.${payload}`).digest('base64url')
}

export function issueCsrfToken({ bearerToken, session, user, now = new Date(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const issuedAt = new Date(now).getTime()
  const boundedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, DEFAULT_TTL_MS) : DEFAULT_TTL_MS
  const expiresAt = Math.min(issuedAt + boundedTtlMs, new Date(session.expiresAt).getTime())
  const payload = encode({
    sub: user.id,
    sid: session.id,
    sth: session.tokenHash,
    iat: issuedAt,
    exp: expiresAt,
    nonce: randomBytes(24).toString('base64url'),
  })
  return { token: `${VERSION}.${payload}.${signature(payload, { bearerToken, session })}`, expiresAt: new Date(expiresAt).toISOString() }
}

export function verifyCsrfToken(csrfToken, { bearerToken, session, user, now = new Date() } = {}) {
  if (!csrfToken) throw csrfError('csrf_required', 'CSRF token is missing.')
  if (String(csrfToken).length > MAX_TOKEN_LENGTH) throw csrfError('csrf_invalid', 'CSRF token is malformed.')
  const parts = String(csrfToken).split('.')
  if (parts.length !== 3 || parts[0] !== VERSION || parts.some((part) => !part)) throw csrfError('csrf_invalid', 'CSRF token is malformed.')
  let claims
  try {
    claims = decode(parts[1])
  } catch {
    throw csrfError('csrf_invalid', 'CSRF token payload is malformed.')
  }
  const expected = Buffer.from(signature(parts[1], { bearerToken, session }))
  const received = Buffer.from(parts[2])
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw csrfError('csrf_invalid', 'CSRF token signature is invalid.')
  if (!Number.isFinite(claims.iat) || typeof claims.nonce !== 'string' || claims.nonce.length < 32) throw csrfError('csrf_invalid', 'CSRF token claims are malformed.')
  if (!Number.isFinite(claims.exp) || claims.exp <= new Date(now).getTime()) throw csrfError('csrf_expired', 'CSRF token has expired.')
  if (claims.sub !== user.id || claims.sid !== session.id || claims.sth !== session.tokenHash) throw csrfError('csrf_invalid', 'CSRF token session binding is invalid.')
  return { valid: true, expiresAt: new Date(claims.exp).toISOString() }
}
