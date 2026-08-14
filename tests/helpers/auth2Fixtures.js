import { hashSessionToken, normalizeAuthenticatedSession, normalizeUserIdentity } from '../../lib/auth/authenticationProvider.js'
import { issueCsrfToken } from '../../lib/security/csrfProtection.js'

export const AUTH2_BEARER = 'dev-token'
export const AUTH2_ORGANIZATION = 'org-atlas-local'
export const AUTH2_ACCOUNT = 'paper-portfolio'

export function auth2Headers({ role = 'owner', subject = 'local-operator', csrf = true } = {}) {
  const user = normalizeUserIdentity({ provider: 'local-development', providerSubject: subject, role })
  const session = normalizeAuthenticatedSession({
    id: `local-session-${subject}`,
    userId: user.id,
    tokenHash: hashSessionToken(AUTH2_BEARER),
    user,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  const csrfToken = csrf ? issueCsrfToken({ bearerToken: AUTH2_BEARER, session, user }).token : null
  return {
    authorization: `Bearer ${AUTH2_BEARER}`,
    'content-type': 'application/json',
    'x-atlas-dev-role': role,
    'x-atlas-dev-subject': subject,
    ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
  }
}

export function auth2Query(overrides = {}) {
  return { organizationId: AUTH2_ORGANIZATION, accountId: AUTH2_ACCOUNT, ...overrides }
}

export function auth2Body(payload = {}) {
  return { organizationId: AUTH2_ORGANIZATION, accountId: AUTH2_ACCOUNT, ...payload }
}
