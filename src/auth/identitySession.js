let sessionExpiredListener = null

export function readIdentityAccessToken(cookieSource = globalThis.document?.cookie ?? '') {
  const match = String(cookieSource).match(/(?:^|;\s*)nf_jwt=([^;]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function setSessionExpiredListener(listener) {
  sessionExpiredListener = typeof listener === 'function' ? listener : null
  return () => {
    if (sessionExpiredListener === listener) sessionExpiredListener = null
  }
}

export function notifySessionExpired() {
  sessionExpiredListener?.()
}
