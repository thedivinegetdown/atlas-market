import { describe, expect, it } from 'vitest'
import { buildApiControlInventory, classifyFunctionSource } from '../scripts/generate-api-control-inventory.mjs'

describe('API control inventory', () => {
  it('classifies boundary, access, CSRF, risk, and remediation priority', () => {
    expect(classifyFunctionSource('submit-paper-order', "createApiHandler(() => {}, { allowedMethods: ['POST'] })"))
      .toMatchObject({ wrapper: 'plain-api', access: 'mutation', boundary: 'none', csrfRequired: false, risk: 'critical', priority: 'P0' })
    expect(classifyFunctionSource('protected-team', "createTeamAuthenticatedApiHandler(() => {}, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin' })"))
      .toMatchObject({ wrapper: 'team-authenticated', access: 'read-and-mutation', boundary: 'organization-and-team', permission: 'workspace.admin', csrfRequired: true, priority: 'P3' })
  })

  it('covers every Netlify Function with a known shared wrapper', () => {
    const inventory = buildApiControlInventory()
    expect(inventory.summary.total).toBe(273)
    expect(inventory.summary.byWrapper).toEqual({
      'team-authenticated': 8,
      'organization-authenticated': 219,
      authenticated: 18,
      'plain-api': 28,
      unknown: 0,
    })
    expect(inventory.summary.byAccess).toEqual({ read: 76, mutation: 56, 'read-and-mutation': 141 })
    expect(inventory.summary.byPriority).toEqual({ P0: 12, P1: 8, P2: 8, P3: 245 })
    expect(inventory.functions.filter((entry) => entry.priority === 'P0').map((entry) => entry.function)).toEqual([
      'cancel-paper-order',
      'create-alert',
      'create-scanner',
      'delete-alert',
      'delete-scanner',
      'evaluate-alerts',
      'evaluate-scanners',
      'recalculate-portfolio',
      'submit-paper-order',
      'update-alert',
      'update-scanner',
      'workspace-configurations',
    ])
    expect(inventory.functions).toHaveLength(273)
    expect(inventory.functions.every((entry) => entry.path.startsWith('netlify/functions/'))).toBe(true)
  })
})
