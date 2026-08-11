import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateProductionConfiguration } from '../lib/system/productionConfigurationValidationEngine.js'

export const LINT_WARNING_BASELINE = 26

const releaseCriticalCommands = Object.freeze([
  { id: 'focused-security-release-tests', command: 'npm', args: ['test', '--', 'tests/phase80-security-accessibility-hardening.test.js', 'tests/phase82-release-closure-merge-readiness.test.js'] },
  { id: 'full-test-suite', command: 'npm', args: ['test'] },
  { id: 'lint', command: 'npm', args: ['run', 'lint'], allowWarnings: true },
  { id: 'production-build', command: 'npm', args: ['run', 'build'] },
  { id: 'performance-budget', command: 'npm', args: ['run', 'performance:check'] },
])

function runCommand(stage, runner) {
  const result = runner(stage.command, stage.args)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return {
    stage: stage.id,
    command: [stage.command, ...stage.args].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
    output,
  }
}

function parseLintWarningCount(output) {
  const match = output.match(/✖\s+\d+\s+problems?\s+\(0 errors,\s+(\d+)\s+warnings?\)/)
  if (match) return Number(match[1])
  const warningLines = output.match(/\swarning\s/g)
  return warningLines?.length ?? 0
}

function buildWarningPresent(output) {
  return /chunk size|Some chunks are larger|chunk-size warning/i.test(output)
}

export function scanMigrationSafety(source) {
  const matches = [...String(source ?? '').matchAll(/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/gi)].map((match) => match[0].toUpperCase())
  return { ok: matches.length === 0, matches }
}

function listFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.netlify', 'tests', 'docs'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, files)
    else if (entry.isFile() && path.replace(/\\/g, '/').endsWith('scripts/release-verify.mjs')) continue
    else if (entry.isFile() && /\.(js|jsx|mjs|json|toml|yml|yaml|env)$/i.test(entry.name) && statSync(path).size < 1024 * 1024) files.push(path)
  }
  return files
}

export function scanSensitiveMaterials({ root = '.', readFile = readFileSync } = {}) {
  const files = existsSync(root) ? listFiles(root) : []
  const findings = []
  const patterns = [
    { id: 'hardcoded-credential', pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\[][^'"]{12,}['"]/i },
    { id: 'private-url', pattern: /https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|[^/\s"'<>]*internal[^/\s"'<>]*)/i },
    { id: 'raw-provider-payload', pattern: /raw(provider|Prompt|Response)\s*[:=]/ },
    { id: 'chain-of-thought', pattern: /chain-of-thought\s*[:=]/i },
    { id: 'live-trading-enabled', pattern: /LIVE_TRADING_ENABLED\s*[:=]\s*['"]?true/i },
  ]
  for (const file of files) {
    const source = readFile(file, 'utf8')
    for (const { id, pattern } of patterns) {
      if (pattern.test(source)) findings.push({ id, file })
    }
  }
  return { ok: findings.length === 0, findings }
}

export function verifyGeneratedArtifacts({ root = '.', gitTrackedFiles = [] } = {}) {
  const generatedTracked = gitTrackedFiles.filter((file) => file === 'dist' || file.startsWith('dist/') || /\.secret(\.|$)/i.test(file))
  return {
    ok: generatedTracked.length === 0,
    generatedTracked,
    distExists: existsSync(join(root, 'dist')),
  }
}

export function createReleaseVerificationSummary({ stages, gitStatus = '', lintWarnings = 0, buildWarning = false, migrationSafety, sensitiveScan, artifactCheck }) {
  const failedStage = stages.find((stage) => stage.status === 'failed')?.stage ?? null
  const ok = !failedStage
    && lintWarnings <= LINT_WARNING_BASELINE
    && !buildWarning
    && migrationSafety.ok
    && sensitiveScan.ok
    && artifactCheck.ok
  return {
    version: 'phase90-release-verification-v1',
    ok,
    failedStage: failedStage
      ?? (lintWarnings > LINT_WARNING_BASELINE ? 'lint-warning-baseline' : null)
      ?? (buildWarning ? 'vite-chunk-warning' : null)
      ?? (!migrationSafety.ok ? 'migration-safety-scan' : null)
      ?? (!sensitiveScan.ok ? 'sensitive-material-scan' : null)
      ?? (!artifactCheck.ok ? 'generated-artifact-check' : null),
    lintWarnings,
    lintWarningBaseline: LINT_WARNING_BASELINE,
    buildWarning,
    migrationSafety,
    sensitiveScan,
    artifactCheck,
    dirtyWorktree: String(gitStatus ?? '').trim().length > 0,
    stages: stages.map(({ output, ...stage }) => stage),
  }
}

export function runReleaseVerification({
  runner = (command, args) => spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' }),
  readFile = readFileSync,
  root = '.',
  gitStatus = '',
  gitTrackedFiles = [],
  env = process.env,
  ci = false,
} = {}) {
  const stages = []
  const config = validateProductionConfiguration({
    env: {
      ...env,
      NODE_ENV: env.NODE_ENV ?? 'production',
      TRADING_MODE: 'paper',
      PAPER_TRADING_ONLY: 'true',
      LIVE_TRADING_ENABLED: 'false',
      DATABASE_URL: env.DATABASE_URL ?? 'configured-for-verification',
      ATLAS_AUTH_MODE: env.ATLAS_AUTH_MODE ?? 'netlify-identity',
      NETLIFY_IDENTITY_URL: env.NETLIFY_IDENTITY_URL ?? 'https://atlas-market.netlify.app/.netlify/identity',
    },
    databaseConfigured: true,
    tenantConfiguration: { configured: true },
    securityConfiguration: { originValidation: true },
    workerConfig: { enabled: true },
    artifactConfig: { retentionDays: 7 },
    apiConfigured: true,
  }, { emitEvent: false })
  stages.push({
    stage: 'configuration-validation',
    command: 'validateProductionConfiguration',
    status: config.configurationValidationStatus === 'blocked' ? 'failed' : 'passed',
    exitCode: config.configurationValidationStatus === 'blocked' ? 1 : 0,
  })
  if (stages[0].status === 'failed') {
    return createReleaseVerificationSummary({
      stages,
      gitStatus,
      lintWarnings: 0,
      buildWarning: false,
      migrationSafety: { ok: true, matches: [] },
      sensitiveScan: { ok: true, findings: [] },
      artifactCheck: { ok: true, generatedTracked: [], distExists: false },
    })
  }

  const commands = ci
    ? [
        { id: 'api-control-inventory', command: 'npm', args: ['run', 'audit:api-controls:check'] },
        ...releaseCriticalCommands.filter((stage) => stage.id !== 'focused-security-release-tests'),
      ]
    : releaseCriticalCommands
  for (const stage of commands) {
    const result = runCommand(stage, runner)
    stages.push(result)
    if (result.status === 'failed') {
      return createReleaseVerificationSummary({
        stages,
        gitStatus,
        lintWarnings: stage.id === 'lint' ? parseLintWarningCount(result.output) : 0,
        buildWarning: stage.id === 'production-build' && buildWarningPresent(result.output),
        migrationSafety: { ok: true, matches: [] },
        sensitiveScan: { ok: true, findings: [] },
        artifactCheck: { ok: true, generatedTracked: [], distExists: false },
      })
    }
  }

  const lintStage = stages.find((stage) => stage.stage === 'lint')
  const buildStage = stages.find((stage) => stage.stage === 'production-build')
  const migrationSafety = scanMigrationSafety(readFile(join(root, 'lib/db/migrations.js'), 'utf8'))
  const sensitiveScan = scanSensitiveMaterials({ root, readFile })
  const artifactCheck = verifyGeneratedArtifacts({ root, gitTrackedFiles })
  return createReleaseVerificationSummary({
    stages,
    gitStatus,
    lintWarnings: parseLintWarningCount(lintStage?.output ?? ''),
    buildWarning: buildWarningPresent(buildStage?.output ?? ''),
    migrationSafety,
    sensitiveScan,
    artifactCheck,
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const gitStatus = spawnSync('git', ['status', '--short'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout ?? ''
  const gitTrackedFiles = (spawnSync('git', ['ls-files'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout ?? '').split(/\r?\n/).filter(Boolean)
  const summary = runReleaseVerification({ gitStatus, gitTrackedFiles, ci: process.argv.includes('--ci') })
  for (const stage of summary.stages) console.log(`${stage.status === 'passed' ? 'PASS' : 'FAIL'} ${stage.stage}`)
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exitCode = 1
}
