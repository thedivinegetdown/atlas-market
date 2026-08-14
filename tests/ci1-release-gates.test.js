import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runReleaseVerification } from '../scripts/release-verify.mjs'

function passingRunner(command, args) {
  const lint = args.includes('lint')
  return { status: 0, stdout: lint ? '✖ 23 problems (0 errors, 23 warnings)' : '', stderr: '' }
}

describe('CI.1 release gate hardening', () => {
  it('runs one coherent CI cycle with every deterministic required gate', () => {
    const calls = []
    const summary = runReleaseVerification({
      ci: true,
      runner: (command, args) => {
        calls.push([command, ...args].join(' '))
        return passingRunner(command, args)
      },
      readFile: () => '',
      root: 'Z:/missing-root',
      gitTrackedFiles: [],
      env: {},
    })
    expect(summary.ok).toBe(true)
    expect(calls).toEqual([
      'npm run audit:api-controls:check',
      'npm test',
      'npm run lint',
      'npm run build',
      'npm run performance:check',
    ])
  })

  it('keeps workflow permissions minimal and fails gates normally', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toContain('run: npm run ci:verify')
    expect(workflow).toContain('run: npm ci')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).not.toMatch(/pull_request_target|continue-on-error|\|\| true/)
  })

  it('retains the approved lint baseline and locked installation workflow', () => {
    const verifier = readFileSync('scripts/release-verify.mjs', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(verifier).toContain('LINT_WARNING_BASELINE = 26')
    expect(packageJson.scripts['ci:verify']).toBe('node scripts/release-verify.mjs --ci')
  })
})
