import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = resolve(scriptDirectory, '..')
export const DEFAULT_JSON_OUTPUT = join(DEFAULT_ROOT, 'docs', 'architecture', 'api-control-inventory.json')
export const DEFAULT_MARKDOWN_OUTPUT = join(DEFAULT_ROOT, 'docs', 'architecture', 'API_CONTROL_INVENTORY.md')

const CONTROL_PATTERNS = Object.freeze([
  ['team-authenticated', /createTeamAuthenticatedApiHandler/],
  ['organization-authenticated', /createProtectedWorkspaceApiHandler/],
  ['organization-authenticated', /createOrganizationAuthenticatedApiHandler/],
  ['authenticated', /createAuthenticatedApiHandler/],
  ['plain-api', /create(?:Persistence)?ApiHandler/],
])
const EXPLICIT_CLASSIFICATIONS = Object.freeze({
  health: ['PUBLIC_READ', 'Minimal liveness/readiness response contains no tenant data, mutation capability, or privileged operational detail.'],
  watchlist: ['PUBLIC_READ', 'Static supported-symbol universe contains no tenant data, mutation capability, or privileged operational detail.'],
  'database-health': ['AUTHENTICATED_READ', 'Database and migration health is privileged operational information restricted to workspace administrators.'],
  'release-runtime-health': ['AUTHENTICATED_READ', 'Release diagnostics are privileged operational information restricted to workspace administrators.'],
  alerts: ['ORGANIZATION_READ', 'Legacy alert state is compatibility-only and requires organization membership.'],
  decision: ['ORGANIZATION_READ', 'Decision intelligence is tenant-sensitive workspace evidence.'],
  'equity-curve': ['ORGANIZATION_READ', 'Paper performance history is tenant-sensitive account evidence.'],
  'journal-summary': ['ORGANIZATION_READ', 'Paper journal content is tenant-sensitive account evidence.'],
  'operator-actions': ['ORGANIZATION_READ', 'Operator actions are scoped operational evidence.'],
  orders: ['ORGANIZATION_READ', 'Paper orders are tenant-sensitive account evidence.'],
  'portfolio-summary': ['ORGANIZATION_READ', 'Legacy portfolio state is compatibility-only tenant-sensitive account evidence.'],
  positions: ['ORGANIZATION_READ', 'Paper positions are tenant-sensitive account evidence.'],
  'risk-summary': ['ORGANIZATION_READ', 'Risk output is tenant-sensitive decision evidence.'],
  scanners: ['ORGANIZATION_READ', 'Legacy scanner state is compatibility-only and requires organization membership.'],
  signals: ['ORGANIZATION_READ', 'Signal output is tenant-sensitive decision evidence.'],
  'system-events': ['ORGANIZATION_READ', 'System events are scoped operational evidence.'],
  'workspace-configurations': ['ORGANIZATION_MUTATION', 'Reads require membership; writes require owner/admin authority and account scope.'],
  'cancel-paper-order': ['COMPATIBILITY_ONLY', 'Legacy paper-order mutation remains non-canonical and owner/admin protected.'],
  'submit-paper-order': ['COMPATIBILITY_ONLY', 'Legacy paper-order mutation remains non-canonical and owner/admin protected.'],
  'create-alert': ['COMPATIBILITY_ONLY', 'Legacy memory alert mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'delete-alert': ['COMPATIBILITY_ONLY', 'Legacy memory alert mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'evaluate-alerts': ['COMPATIBILITY_ONLY', 'Legacy memory alert evaluation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'update-alert': ['COMPATIBILITY_ONLY', 'Legacy memory alert mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'create-scanner': ['COMPATIBILITY_ONLY', 'Legacy memory scanner mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'delete-scanner': ['COMPATIBILITY_ONLY', 'Legacy memory scanner mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'evaluate-scanners': ['COMPATIBILITY_ONLY', 'Legacy memory scanner evaluation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'update-scanner': ['COMPATIBILITY_ONLY', 'Legacy memory scanner mutation remains owner/admin protected; PI.4 durable configuration is canonical.'],
  'recalculate-portfolio': ['COMPATIBILITY_ONLY', 'Legacy process-memory portfolio recomputation is owner/admin protected and non-canonical.'],
})
const SENSITIVE_READS = Object.freeze([
  /orders?/, /positions?/, /portfolio/, /risk/, /journal/, /signals?/,
  /operator-actions?/, /system-events?/, /workspace-configurations?/,
])

function quotedValues(source = '') {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function boundaryFor(wrapper) {
  if (wrapper === 'team-authenticated') return 'organization-and-team'
  if (wrapper === 'organization-authenticated') return 'organization'
  if (wrapper === 'authenticated') return 'authenticated-user/workspace-role'
  return 'none'
}

function assessRisk({ endpoint, wrapper, access, csrfRequired }) {
  if (wrapper === 'unknown') return { risk: 'critical', priority: 'P0', remediation: 'Adopt an approved shared API wrapper before release.' }
  if (wrapper === 'plain-api' && access !== 'read') return { risk: 'critical', priority: 'P0', remediation: 'Require authentication, authorization, tenant scope where applicable, and CSRF protection.' }
  if (wrapper === 'plain-api' && SENSITIVE_READS.some((pattern) => pattern.test(endpoint))) return { risk: 'high', priority: 'P1', remediation: 'Require authentication and the narrowest applicable user, organization, or team boundary.' }
  if (wrapper === 'plain-api' && EXPLICIT_CLASSIFICATIONS[endpoint]?.[0] === 'PUBLIC_READ') return { risk: 'controlled', priority: 'P3', remediation: 'Retain explicit public-read policy and regression coverage.' }
  if (wrapper === 'plain-api') return { risk: 'medium', priority: 'P2', remediation: 'Document intentional public access or migrate to an authenticated wrapper.' }
  if (access !== 'read' && !csrfRequired) return { risk: 'high', priority: 'P1', remediation: 'Add verified CSRF protection for authenticated mutations.' }
  return { risk: 'controlled', priority: 'P3', remediation: 'Retain wrapper coverage and verify production identity/provider configuration.' }
}

export function classifyFunctionSource(endpoint, source = '') {
  const wrapper = CONTROL_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? 'unknown'
  const allowedMethodsSource = source.match(/allowedMethods\s*:\s*\[([^\]]+)\]/)?.[1]
  const methods = allowedMethodsSource
    ? [...new Set(quotedValues(allowedMethodsSource).map((method) => method.toUpperCase()))]
    : ['GET']
  const readMethods = methods.filter((method) => ['GET', 'HEAD', 'OPTIONS'].includes(method))
  const mutationMethods = methods.filter((method) => !['GET', 'HEAD', 'OPTIONS'].includes(method))
  const access = mutationMethods.length === 0 ? 'read' : readMethods.length === 0 ? 'mutation' : 'read-and-mutation'
  const authenticated = !['plain-api', 'unknown'].includes(wrapper)
  const csrfRequired = authenticated && mutationMethods.length > 0
  const classification = {
    wrapper,
    methods,
    access,
    authenticated,
    boundary: boundaryFor(wrapper),
    permission: source.match(/requiredPermission\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null,
    csrfRequired,
    endpointClassification: EXPLICIT_CLASSIFICATIONS[endpoint]?.[0] ?? (access === 'read' ? 'AUTHENTICATED_READ' : 'AUTHENTICATED_MUTATION'),
    classificationReason: EXPLICIT_CLASSIFICATIONS[endpoint]?.[1] ?? 'Protected by the existing authenticated control and authorization boundary.',
  }
  return { ...classification, ...assessRisk({ endpoint, wrapper, access, csrfRequired }) }
}

export function buildApiControlInventory({ root = DEFAULT_ROOT } = {}) {
  const functionsDirectory = join(root, 'netlify', 'functions')
  const functions = readdirSync(functionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => {
      const endpoint = entry.name.replace(/\.js$/, '')
      const absolutePath = join(functionsDirectory, entry.name)
      return {
        function: endpoint,
        path: relative(root, absolutePath).replaceAll('\\', '/'),
        ...classifyFunctionSource(endpoint, readFileSync(absolutePath, 'utf8')),
      }
    })
    .sort((left, right) => left.function.localeCompare(right.function))
  const count = (predicate) => functions.filter(predicate).length
  return {
    schemaVersion: 2,
    generatedFrom: 'netlify/functions/*.js',
    summary: {
      total: functions.length,
      byWrapper: Object.fromEntries(['team-authenticated', 'organization-authenticated', 'authenticated', 'plain-api', 'unknown'].map((wrapper) => [wrapper, count((entry) => entry.wrapper === wrapper)])),
      byAccess: Object.fromEntries(['read', 'mutation', 'read-and-mutation'].map((access) => [access, count((entry) => entry.access === access)])),
      byPriority: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((priority) => [priority, count((entry) => entry.priority === priority)])),
    },
    functions,
  }
}

export function renderMarkdown(inventory) {
  const { summary, functions } = inventory
  const lines = [
    '# Atlas Market API Control Inventory', '',
    'Status: generated source inventory', '',
    'Run `npm run audit:api-controls` to regenerate this document and its JSON counterpart. Run `npm run audit:api-controls:check` to verify that both artifacts match source.', '',
    'This inventory reports source-level controls. It does not prove production identity-provider, session, database, provider-key, origin-policy, or deployment configuration.', '',
    '## Summary', '', '| Classification | Count |', '| --- | ---: |',
    `| Total functions | ${summary.total} |`,
    ...Object.entries(summary.byWrapper).map(([name, value]) => `| Wrapper: ${name} | ${value} |`),
    ...Object.entries(summary.byAccess).map(([name, value]) => `| Access: ${name} | ${value} |`),
    ...Object.entries(summary.byPriority).map(([name, value]) => `| Priority: ${name} | ${value} |`), '',
    '## Control semantics', '',
    '- `plain-api` has shared method, request-size, JSON, unsafe-key, process-local rate-limit, error, and observability controls, but no authenticated wrapper.',
    '- Authenticated mutations require a server-issued, bearer-session-bound, expiring HMAC CSRF token validated independently after authentication.',
    '- Organization and team classifications reflect wrapper intent and repository membership checks, not verified production identity or durable membership configuration.',
    '- P0 identifies plain-wrapper mutation surfaces. P1 identifies sensitive plain reads or protected mutations missing expected CSRF coverage. P2 requires a public-access decision. P3 is source-controlled but still depends on production configuration.', '',
    '## Functions', '',
    '| Function | Path | Classification | Reason | Methods | Access | Wrapper | Boundary | CSRF | Risk | Priority | Remediation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const entry of functions) lines.push(`| \`${entry.function}\` | \`${entry.path}\` | ${entry.endpointClassification} | ${entry.classificationReason} | ${entry.methods.join(', ')} | ${entry.access} | ${entry.wrapper} | ${entry.boundary} | ${entry.csrfRequired ? 'required' : 'no'} | ${entry.risk} | ${entry.priority} | ${entry.remediation} |`)
  return `${lines.join('\n')}\n`
}

export const renderJson = (inventory) => `${JSON.stringify(inventory, null, 2)}\n`

export const normalizeLineEndings = (content) => String(content).replace(/\r\n/g, '\n')

function main() {
  const inventory = buildApiControlInventory()
  const artifacts = [[DEFAULT_JSON_OUTPUT, renderJson(inventory)], [DEFAULT_MARKDOWN_OUTPUT, renderMarkdown(inventory)]]
  if (process.argv.includes('--check')) {
    const stale = artifacts.filter(([path, content]) => !existsSync(path) || normalizeLineEndings(readFileSync(path, 'utf8')) !== normalizeLineEndings(content))
    if (stale.length > 0) {
      console.error(`API control inventory is stale: ${stale.map(([path]) => relative(DEFAULT_ROOT, path)).join(', ')}`)
      process.exitCode = 1
      return
    }
    console.log('API control inventory is current.')
    return
  }
  for (const [path, content] of artifacts) writeFileSync(path, content, 'utf8')
  console.log(`Wrote ${artifacts.map(([path]) => relative(DEFAULT_ROOT, path)).join(' and ')}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
