import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = resolve(scriptDirectory, '..')
export const DEFAULT_JSON_OUTPUT = join(DEFAULT_ROOT, 'docs', 'architecture', 'api-control-inventory.json')
export const DEFAULT_MARKDOWN_OUTPUT = join(DEFAULT_ROOT, 'docs', 'architecture', 'API_CONTROL_INVENTORY.md')

const CONTROL_PATTERNS = Object.freeze([
  ['team-authenticated', /createTeamAuthenticatedApiHandler/],
  ['organization-authenticated', /createOrganizationAuthenticatedApiHandler/],
  ['authenticated', /createAuthenticatedApiHandler/],
  ['plain-api', /create(?:Persistence)?ApiHandler/],
])
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
    schemaVersion: 1,
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
    '- Authenticated mutations require the current wrapper CSRF-token presence check; this is not evidence of cryptographic token verification.',
    '- Organization and team classifications reflect wrapper intent and repository membership checks, not verified production identity or durable membership configuration.',
    '- P0 identifies plain-wrapper mutation surfaces. P1 identifies sensitive plain reads or protected mutations missing expected CSRF coverage. P2 requires a public-access decision. P3 is source-controlled but still depends on production configuration.', '',
    '## Functions', '',
    '| Function | Path | Methods | Access | Wrapper | Boundary | CSRF | Risk | Priority | Remediation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const entry of functions) lines.push(`| \`${entry.function}\` | \`${entry.path}\` | ${entry.methods.join(', ')} | ${entry.access} | ${entry.wrapper} | ${entry.boundary} | ${entry.csrfRequired ? 'required' : 'no'} | ${entry.risk} | ${entry.priority} | ${entry.remediation} |`)
  return `${lines.join('\n')}\n`
}

export const renderJson = (inventory) => `${JSON.stringify(inventory, null, 2)}\n`

function main() {
  const inventory = buildApiControlInventory()
  const artifacts = [[DEFAULT_JSON_OUTPUT, renderJson(inventory)], [DEFAULT_MARKDOWN_OUTPUT, renderMarkdown(inventory)]]
  if (process.argv.includes('--check')) {
    const stale = artifacts.filter(([path, content]) => !existsSync(path) || readFileSync(path, 'utf8') !== content)
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
