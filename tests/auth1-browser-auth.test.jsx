import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { IdentityAuthBoundary, IdentityAuthProvider } from '../src/auth/IdentityAuth.jsx'
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
    ...overrides,
  }
}

async function renderAuth(identityClient) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<IdentityAuthProvider identityClient={identityClient}><IdentityAuthBoundary><p>Protected workspace</p></IdentityAuthBoundary></IdentityAuthProvider>)
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  setSessionExpiredListener(null)
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
    const password = container.querySelector('input[type="password"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(password, 'secure-password')
      password.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(identityClient.acceptInvite).toHaveBeenCalledWith('private-invite-token', 'secure-password')
    expect(container.textContent).toContain('Protected workspace')
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
