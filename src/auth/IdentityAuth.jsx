import { useEffect, useMemo, useState } from 'react'
import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login as identityLogin,
  logout as identityLogout,
  onAuthChange,
} from '@netlify/identity'
import { setSessionExpiredListener } from './identitySession.js'
import { IdentityAuthContext, useIdentityAuth } from './identityAuthContext.js'

const isTestRuntime = import.meta.env.MODE === 'test'
const testUser = { id: 'local-development:local-test-operator', email: 'operator@localhost', roles: ['owner'] }
const defaultIdentityClient = isTestRuntime ? {
  acceptInvite: async () => testUser,
  getUser: async () => testUser,
  handleAuthCallback: async () => null,
  login: async () => testUser,
  logout: async () => {},
  onAuthChange: () => () => {},
} : {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login: identityLogin,
  logout: identityLogout,
  onAuthChange,
}

function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function IdentityAuthProvider({ children, identityClient = defaultIdentityClient }) {
  const usesTestDefault = isTestRuntime && identityClient === defaultIdentityClient
  const [status, setStatus] = useState(usesTestDefault ? 'authenticated' : 'loading')
  const [user, setUser] = useState(usesTestDefault ? testUser : null)
  const [inviteToken, setInviteToken] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    const unsubscribeExpired = setSessionExpiredListener(() => {
      setUser(null)
      setStatus('expired')
      setError('Your session expired. Sign in again to continue.')
    })
    const unsubscribeAuth = identityClient.onAuthChange((_event, nextUser) => {
      if (!active) return
      setUser(nextUser)
      setStatus(nextUser ? 'authenticated' : 'unauthenticated')
      setError(null)
    })

    async function restore() {
      try {
        const callback = await identityClient.handleAuthCallback()
        if (!active) return
        if (callback?.type === 'invite' && callback.token) {
          setInviteToken(callback.token)
          setStatus('invite')
          return
        }
        const restoredUser = callback?.user ?? await identityClient.getUser()
        if (!active) return
        setUser(restoredUser)
        setStatus(restoredUser ? 'authenticated' : 'unauthenticated')
      } catch (restoreError) {
        if (!active) return
        setStatus('unauthenticated')
        setError(safeMessage(restoreError, 'Unable to restore your session.'))
      }
    }

    restore()
    return () => {
      active = false
      unsubscribeAuth?.()
      unsubscribeExpired()
    }
  }, [identityClient])

  const value = useMemo(() => ({
    status,
    user,
    error,
    async login(email, password) {
      setStatus('loading')
      setError(null)
      try {
        const nextUser = await identityClient.login(email, password)
        setUser(nextUser)
        setStatus('authenticated')
      } catch (loginError) {
        setUser(null)
        setStatus('unauthenticated')
        setError(safeMessage(loginError, 'Sign in failed.'))
      }
    },
    async acceptInvitation(password) {
      if (!inviteToken) return
      setStatus('loading')
      setError(null)
      try {
        const nextUser = await identityClient.acceptInvite(inviteToken, password)
        setInviteToken(null)
        setUser(nextUser)
        setStatus('authenticated')
      } catch (inviteError) {
        setStatus('invite')
        setError(safeMessage(inviteError, 'Unable to accept the invitation.'))
      }
    },
    async logout() {
      try {
        await identityClient.logout()
      } finally {
        setUser(null)
        setStatus('unauthenticated')
        setError(null)
      }
    },
  }), [error, identityClient, inviteToken, status, user])

  return <IdentityAuthContext.Provider value={value}>{children}</IdentityAuthContext.Provider>
}

function AuthenticationCard({ mode, error, onLogin, onAccept }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const isInvite = mode === 'invite'

  return (
    <main className="auth-boundary">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand-mark" aria-hidden="true">AM</div>
        <p className="auth-eyebrow">Atlas Market · Paper Trading</p>
        <h1 id="auth-title">{isInvite ? 'Accept your invitation' : 'Sign in to Atlas Market'}</h1>
        <p className="auth-copy">{isInvite ? 'Set a password to activate your invited account.' : 'Access is limited to invited operators.'}</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (isInvite) onAccept(password)
          else onLogin(email, password)
        }}>
          {!isInvite && <label>Email<input name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          <label>Password<input name="password" type="password" autoComplete={isInvite ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit">{isInvite ? 'Activate account' : 'Sign in'}</button>
        </form>
        <p className="auth-footnote">No public signup or social sign-in is enabled.</p>
      </section>
    </main>
  )
}

export function IdentityAuthBoundary({ children }) {
  const auth = useIdentityAuth()
  if (auth.status === 'loading') {
    return <main className="auth-boundary"><section className="auth-card" aria-live="polite"><p>Restoring secure session…</p></section></main>
  }
  if (auth.status !== 'authenticated') {
    return <AuthenticationCard mode={auth.status} error={auth.error} onLogin={auth.login} onAccept={auth.acceptInvitation} />
  }
  return children
}
