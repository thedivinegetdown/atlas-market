import { useEffect, useMemo, useState } from 'react'
import {
  AUTH_EVENTS,
  acceptInvite,
  getUser,
  handleAuthCallback,
  login as identityLogin,
  logout as identityLogout,
  onAuthChange,
  updateUser,
} from '@netlify/identity'
import { clearWorkspaceCsrfState } from '../api/workspaceApiClient.js'
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
  updateUser: async () => testUser,
} : {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login: identityLogin,
  logout: identityLogout,
  onAuthChange,
  updateUser,
}

function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

function hasRecoveryCallback() {
  return typeof window !== 'undefined' && /(?:^#|[&#])recovery_token=/.test(window.location.hash)
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
    const unsubscribeAuth = identityClient.onAuthChange((event, nextUser) => {
      if (!active) return
      if (event === AUTH_EVENTS.RECOVERY) {
        setUser(nextUser)
        setStatus(nextUser ? 'recovery' : 'unauthenticated')
        setError(nextUser ? null : 'This password recovery link is invalid or expired. Request a new reset email.')
        return
      }
      setUser(nextUser)
      setStatus(nextUser ? 'authenticated' : 'unauthenticated')
      setError(null)
    })

    async function restore() {
      const recoveryCallbackExpected = hasRecoveryCallback()
      try {
        const callback = await identityClient.handleAuthCallback()
        if (!active) return
        if (callback?.type === 'invite' && callback.token) {
          setInviteToken(callback.token)
          setStatus('invite')
          return
        }
        if (callback?.type === 'recovery') {
          setUser(callback.user)
          setStatus(callback.user ? 'recovery' : 'unauthenticated')
          setError(callback.user ? null : 'This password recovery link is invalid or expired. Request a new reset email.')
          return
        }
        const restoredUser = callback?.user ?? await identityClient.getUser()
        if (!active) return
        setUser(restoredUser)
        setStatus(restoredUser ? 'authenticated' : 'unauthenticated')
      } catch (restoreError) {
        if (!active) return
        setUser(null)
        setStatus('unauthenticated')
        setError(recoveryCallbackExpected
          ? 'This password recovery link is invalid or expired. Request a new reset email.'
          : safeMessage(restoreError, 'Unable to restore your session.'))
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
    async completePasswordRecovery(password, passwordConfirmation) {
      if (password !== passwordConfirmation) {
        setStatus('recovery')
        setError('Passwords do not match.')
        return
      }
      if (password.length < 8) {
        setStatus('recovery')
        setError('Password must be at least 8 characters.')
        return
      }
      setStatus('loading')
      setError(null)
      try {
        const nextUser = await identityClient.updateUser({ password })
        setUser(nextUser)
        setStatus('authenticated')
      } catch {
        setStatus('recovery')
        setError('Unable to update password. The recovery session may have expired; request a new reset email.')
      }
    },
    async logout() {
      try {
        await identityClient.logout()
      } finally {
        clearWorkspaceCsrfState()
        setUser(null)
        setStatus('unauthenticated')
        setError(null)
      }
    },
  }), [error, identityClient, inviteToken, status, user])

  return <IdentityAuthContext.Provider value={value}>{children}</IdentityAuthContext.Provider>
}

function PasswordRecoveryCard({ error, onComplete }) {
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')

  return (
    <main className="auth-boundary">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand-mark" aria-hidden="true">AM</div>
        <p className="auth-eyebrow">Atlas Market · Account Recovery</p>
        <h1 id="auth-title">Set a new password</h1>
        <p className="auth-copy">Choose a new password for your Atlas Market account.</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          onComplete(password, passwordConfirmation)
        }}>
          <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm new password<input name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit">Update password</button>
        </form>
      </section>
    </main>
  )
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
  if (auth.status === 'recovery') {
    return <PasswordRecoveryCard error={auth.error} onComplete={auth.completePasswordRecovery} />
  }
  if (auth.status !== 'authenticated') {
    return <AuthenticationCard mode={auth.status} error={auth.error} onLogin={auth.login} onAccept={auth.acceptInvitation} />
  }
  return children
}
