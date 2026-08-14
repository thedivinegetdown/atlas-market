import { describe, expect, it } from 'vitest'
import { buildApiControlInventory, classifyFunctionSource, normalizeLineEndings } from '../scripts/generate-api-control-inventory.mjs'

describe('API control inventory', () => {
  it('compares generated artifacts consistently across Windows and Linux checkouts', () => {
    expect(normalizeLineEndings('alpha\r\nbeta\r\n')).toBe('alpha\nbeta\n')
  })

  it('classifies boundary, access, CSRF, risk, and remediation priority', () => {
    expect(classifyFunctionSource('submit-paper-order', "createApiHandler(() => {}, { allowedMethods: ['POST'] })"))
      .toMatchObject({ wrapper: 'plain-api', access: 'mutation', boundary: 'none', csrfRequired: false, risk: 'critical', priority: 'P0' })
    expect(classifyFunctionSource('protected-team', "createTeamAuthenticatedApiHandler(() => {}, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin' })"))
      .toMatchObject({ wrapper: 'team-authenticated', access: 'read-and-mutation', boundary: 'organization-and-team', permission: 'workspace.admin', csrfRequired: true, priority: 'P3' })
  })

  it('covers every Netlify Function with a known shared wrapper', () => {
    const inventory = buildApiControlInventory()
    expect(inventory.summary.total).toBe(274)
    expect(inventory.summary.byWrapper).toEqual({
      'team-authenticated': 8,
      'organization-authenticated': 243,
      authenticated: 21,
      'plain-api': 2,
      unknown: 0,
    })
    expect(inventory.summary.byAccess).toEqual({ read: 77, mutation: 56, 'read-and-mutation': 141 })
    expect(inventory.summary.byPriority).toEqual({ P0: 0, P1: 0, P2: 0, P3: 274 })
    expect(inventory.functions.filter((entry) => entry.wrapper === 'plain-api').map((entry) => entry.function)).toEqual(['health', 'watchlist'])
    expect(inventory.functions).toHaveLength(274)
    expect(inventory.functions.every((entry) => entry.path.startsWith('netlify/functions/'))).toBe(true)
  })
})
