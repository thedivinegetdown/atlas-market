import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { IdentityAuthBoundary, IdentityAuthProvider } from '../src/auth/IdentityAuth.jsx'
import { useIdentityAuth } from '../src/auth/identityAuthContext.js'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'
import { setSessionExpiredListener } from '../src/auth/identitySession.js'

let root
let container

function client(overrides = {}) {
  return {
    acceptInvite: vi.fn(),
    getUser: vi.fn().mockResolvedValue(null),
    handleAuthCallback: vi.fn().mockResolvedValue(null),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    onAuthChange: vi.fn(() => () => {}),
    updateUser: vi.fn(),
    ...overrides,
  }
}

function SessionProbe() {
  const auth = useIdentityAuth()
  return <div><p>Protected workspace</p><button type="button" onClick={auth.logout}>Sign out test user</button></div>
}

async function renderAuth(identityClient, children = <SessionProbe />) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<IdentityAuthProvider identityClient={identityClient}><IdentityAuthBoundary>{children}</IdentityAuthBoundary></IdentityAuthProvider>)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function changeInput(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function submitForm() {
  await act(async () => {
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  setSessionExpiredListener(null)
  window.history.replaceState({}, '', '/')
})

describe('AUTH.1 browser authentication boundary', () => {
  it('restores an existing Identity session before rendering protected content', async () => {
    const identityClient = client({ getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'operator@example.test' }) })
    await renderAuth(identityClient)
    expect(identityClient.handleAuthCallback).toHaveBeenCalledOnce()
    expect(identityClient.getUser).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Protected workspace')
  })

  it('processes invite callbacks and accepts a password without exposing the invite token', async () => {
    const identityClient = client({
      handleAuthCallback: vi.fn().mockResolvedValue({ type: 'invite', user: null, token: 'private-invite-token' }),
      acceptInvite: vi.fn().mockResolvedValue({ id: 'user-1' }),
    })
    await renderAuth(identityClient)
    expect(container.textContent).toContain('Accept your invitation')
    expect(container.textContent).not.toContain('private-invite-token')
    await changeInput(container.querySelector('input[type="password"]'), 'secure-password')
    await submitForm()
    expect(identityClient.acceptInvite).toHaveBeenCalledWith('private-invite-token', 'secure-password')
    expect(container.textContent).toContain('Protected workspace')
  })

  it('holds a valid recovery callback at an accessible set-new-password interface without displaying its token', async () => {
    window.history.replaceState({}, '', '/#recovery_token=private-recovery-token')
    const identityClient = client({
      handleAuthCallback: vi.fn().mockResolvedValue({ type: 'recovery', user: { id: 'user-1' } }),
    })
    await renderAuth(identityClient)
    expect(container.querySelector('h1').textContent).toBe('Set a new password')
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2)
    expect(container.textContent).not.toContain('private-recovery-token')
    expect(container.querySelector('[autocomplete="new-password"]')).toBeTruthy()
  })

  it('updates the password and continues to the authenticated Atlas experience', async () => {
    const identityClient = client({
      handleAuthCallback: vi.fn().mockResolvedValue({ type: 'recovery', user: { id: 'user-1' } }),
      updateUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    })
    await renderAuth(identityClient)
    const [password, confirmation] = container.querySelectorAll('input[type="password"]')
    await changeInput(password, 'new-secure-password')
    await changeInput(confirmation, 'new-secure-password')
    await submitForm()
    expect(identityClient.updateUser).toHaveBeenCalledWith({ password: 'new-secure-password' })
    expect(container.textContent).toContain('Protected workspace')
  })

  it('rejects mismatched password confirmation without calling Identity', async () => {
    const identityClient = client({ handleAuthCallback: vi.fn().mockResolvedValue({ type: 'recovery', user: { id: 'user-1' } }) })
    await renderAuth(identityClient)
    const [password, confirmation] = container.querySelectorAll('input[type="password"]')
    await changeInput(password, 'new-secure-password')
    await changeInput(confirmation, 'different-password')
    await submitForm()
    expect(container.querySelector('[role="alert"]').textContent).toBe('Passwords do not match.')
    expect(identityClient.updateUser).not.toHaveBeenCalled()
  })

  it.each(['invalid', 'expired'])('handles an %s recovery callback safely without exposing or logging token material', async (failure) => {
    const recoveryToken = `private-${failure}-recovery-token`
    window.history.replaceState({}, '', `/#recovery_token=${recoveryToken}`)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const identityClient = client({
      handleAuthCallback: vi.fn().mockRejectedValue(new Error(`${failure} ${recoveryToken}`)),
    })
    await renderAuth(identityClient)
    expect(container.textContent).toContain('invalid or expired')
    expect(container.textContent).not.toContain(recoveryToken)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(recoveryToken)
    consoleError.mockRestore()
  })

  it('preserves normal login behavior', async () => {
    const identityClient = client({ login: vi.fn().mockResolvedValue({ id: 'user-1' }) })
    await renderAuth(identityClient)
    await changeInput(container.querySelector('input[type="email"]'), 'owner@example.test')
    await changeInput(container.querySelector('input[type="password"]'), 'secure-password')
    await submitForm()
    expect(identityClient.login).toHaveBeenCalledWith('owner@example.test', 'secure-password')
    expect(container.textContent).toContain('Protected workspace')
  })

  it('preserves logout and returns to the unauthenticated boundary', async () => {
    const identityClient = client({ getUser: vi.fn().mockResolvedValue({ id: 'user-1' }) })
    await renderAuth(identityClient)
    await act(async () => {
      container.querySelector('button').click()
      await Promise.resolve()
    })
    expect(identityClient.logout).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Sign in to Atlas Market')
  })

  it('attaches the current Identity bearer and signals an expired API session on 401', async () => {
    const expired = vi.fn()
    setSessionExpiredListener(expired)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: { message: 'authentication required' } }),
    })
    const api = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'identity-access-token' })
    await expect(api.getWatchlist()).rejects.toThrow('authentication required')
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer identity-access-token')
    expect(expired).toHaveBeenCalledOnce()
  })
})
