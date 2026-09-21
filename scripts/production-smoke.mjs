import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { workspaceRoutes } from '../src/workspaces/workspaceRoutes.js'

export const READ_ONLY_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS'])
export const DEFAULT_BASE_URL = 'https://atlas-market.netlify.app'
const DEFAULT_TIMEOUT_MS = 30_000
const SENSITIVE_KEY = /(authorization|bearer|cookie|csrf|password|secret|token|credential|session|tenant|organization|account|user|email)/i

function cleanText(value) {
  return String(value ?? '')
    .replace(/[A-Z]:\\Users\\[^\\\s'"`]+/gi, '[LOCAL_PROFILE]')
    .replace(/\/(?:Users|home)\/[^/\s'"`]+/g, '/[LOCAL_PROFILE]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/([?&](?:token|code|key|secret|state|invite|recovery)[^=]*)=[^&#\s]*/gi, '$1=[REDACTED]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[REDACTED_ID]')
    .slice(0, 500)
}

export function sanitizeUrl(value, baseUrl = DEFAULT_BASE_URL) {
  try {
    const url = new URL(value, baseUrl)
    const base = new URL(baseUrl)
    return url.origin === base.origin ? url.pathname : url.origin
  } catch {
    return '[INVALID_URL]'
  }
}

export function sanitizeEvidence(value, key = '', baseUrl = DEFAULT_BASE_URL) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item, '', baseUrl))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeEvidence(childValue, childKey, baseUrl)]))
  }
  if (typeof value === 'string') return cleanText(value)
  return value
}

export function assertReadOnlyMethod(method) {
  const normalized = String(method ?? 'GET').toUpperCase()
  if (!READ_ONLY_METHODS.includes(normalized)) throw new Error(`blocked non-read-only request method: ${normalized}`)
  return normalized
}

export function parseArguments(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: env.ATLAS_SMOKE_BASE_URL ?? DEFAULT_BASE_URL,
    cdpUrl: env.ATLAS_SMOKE_CDP_URL ?? null,
    browser: env.ATLAS_SMOKE_BROWSER ?? null,
    userDataDir: env.ATLAS_SMOKE_USER_DATA_DIR ?? null,
    profileDirectory: env.ATLAS_SMOKE_PROFILE_DIRECTORY ?? null,
    output: env.ATLAS_SMOKE_OUTPUT ?? null,
    timeoutMs: Number(env.ATLAS_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  }
  for (const argument of argv) {
    const [name, ...rest] = argument.split('=')
    const value = rest.join('=')
    if (name === '--base-url') options.baseUrl = value
    else if (name === '--cdp-url') options.cdpUrl = value
    else if (name === '--browser') options.browser = value
    else if (name === '--user-data-dir') options.userDataDir = value
    else if (name === '--profile-directory') options.profileDirectory = value
    else if (name === '--output') options.output = value
    else if (name === '--timeout-ms') options.timeoutMs = Number(value)
    else throw new Error(`unknown production smoke option: ${name}`)
  }
  const parsedBase = new URL(options.baseUrl)
  if (!['https:', 'http:'].includes(parsedBase.protocol)) throw new Error('smoke base URL must use HTTP or HTTPS')
  options.baseUrl = parsedBase.origin
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('smoke timeout must be at least 1000ms')
  return options
}

function browserCandidates() {
  if (process.platform === 'win32') return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  if (process.platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`browser protocol endpoint returned HTTP ${response.status}`)
  return response.json()
}

async function waitForCdp(cdpUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      await fetchJson(`${cdpUrl}/json/version`, {}, 2_000)
      return
    } catch (error) {
      lastError = error
      await delay(150)
    }
  }
  throw new Error(`browser protocol did not become ready: ${cleanText(lastError?.message)}`)
}

async function launchBrowser(options) {
  const executable = options.browser ?? browserCandidates().find(existsSync)
  if (!executable) throw new Error('no Chromium browser found; set ATLAS_SMOKE_BROWSER or ATLAS_SMOKE_CDP_URL')
  const temporaryProfile = options.userDataDir ? null : mkdtempSync(join(tmpdir(), 'atlas-production-smoke-'))
  const userDataDir = resolve(options.userDataDir ?? temporaryProfile)
  const port = 9223 + Math.floor(Math.random() * 500)
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  if (options.profileDirectory) args.splice(2, 0, `--profile-directory=${options.profileDirectory}`)
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
  const cdpUrl = `http://127.0.0.1:${port}`
  try {
    await waitForCdp(cdpUrl, options.timeoutMs)
  } catch (error) {
    child.kill()
    if (temporaryProfile?.startsWith(tmpdir())) rmSync(temporaryProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    throw error
  }
  return {
    cdpUrl,
    async close() {
      child.kill()
      if (child.exitCode === null) {
        await Promise.race([
          new Promise((resolvePromise) => child.once('exit', resolvePromise)),
          delay(3_000),
        ])
      }
      if (temporaryProfile?.startsWith(tmpdir())) rmSync(temporaryProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

class CdpSession {
  constructor(url, timeoutMs) {
    this.url = url
    this.timeoutMs = timeoutMs
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('browser websocket connection timed out')), this.timeoutMs)
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise() }, { once: true })
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('browser websocket connection failed')) }, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        Promise.resolve(listener(message.params ?? {})).catch(() => {})
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`browser command timed out: ${method}`))
      }, this.timeoutMs)
      this.pending.set(id, {
        resolve(value) { clearTimeout(timer); resolvePromise(value) },
        reject(error) { clearTimeout(timer); reject(error) },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(listener)
    return () => this.listeners.get(method)?.delete(listener)
  }

  waitFor(method, predicate = () => true) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`browser event timed out: ${method}`)) }, this.timeoutMs)
      const unsubscribe = this.on(method, (params) => {
        if (!predicate(params)) return
        clearTimeout(timer)
        unsubscribe()
        resolvePromise(params)
      })
    })
  }

  close() {
    this.socket?.close()
  }
}

async function createPage(cdpUrl, timeoutMs) {
  const target = await fetchJson(`${cdpUrl}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }, timeoutMs)
  const session = new CdpSession(target.webSocketDebuggerUrl, timeoutMs)
  await session.connect()
  return { session, targetId: target.id }
}

async function closePage(cdpUrl, targetId, session, timeoutMs) {
  session.close()
  try { await fetch(`${cdpUrl}/json/close/${targetId}`, { signal: AbortSignal.timeout(timeoutMs) }) } catch { /* browser shutdown is best effort */ }
}

function consoleMessageClass(message) {
  if (/chunk(?:load)?error|loading chunk|dynamically imported module/i.test(message)) return 'chunk-load-error'
  if (/typeerror/i.test(message)) return 'type-error'
  if (/referenceerror/i.test(message)) return 'reference-error'
  if (/networkerror|failed to fetch/i.test(message)) return 'network-error'
  return 'console-error'
}

function consoleFailure(params, baseUrl) {
  const message = params.args?.map((argument) => argument.value ?? argument.description ?? argument.type).join(' ') ?? params.type
  const frame = params.stackTrace?.callFrames?.[0]
  return {
    level: params.type,
    category: consoleMessageClass(message),
    messageFingerprint: createHash('sha256').update(String(message)).digest('hex').slice(0, 16),
    source: sanitizeUrl(frame?.url ?? '', baseUrl),
    line: Number.isInteger(frame?.lineNumber) ? frame.lineNumber : null,
    column: Number.isInteger(frame?.columnNumber) ? frame.columnNumber : null,
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error('browser evaluation failed')
  return result.result?.value
}

async function waitForWorkspace(session, expectedLabel, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await evaluate(session, `(() => ({ authenticated: Boolean(document.querySelector('.trading-os-shell')), label: document.querySelector('.top-title-area h1')?.textContent?.trim() ?? null, routeError: Boolean(document.querySelector('.workspace-route-error')), loading: Boolean(document.querySelector('.workspace-route-content [role="status"]')) }))()`)
    if (!state?.authenticated) return state
    if (state.label === expectedLabel && !state.loading) return state
    await delay(100)
  }
  throw new Error(`workspace render timed out for ${expectedLabel}`)
}

async function navigateAndWait(session, url) {
  const loaded = session.waitFor('Page.loadEventFired')
  const result = await session.send('Page.navigate', { url })
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`)
  await loaded
}

async function reloadAndWait(session) {
  const loaded = session.waitFor('Page.loadEventFired')
  await session.send('Page.reload', { ignoreCache: true })
  await loaded
}

async function probeHealth(baseUrl, timeoutMs) {
  async function status(path) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: assertReadOnlyMethod('GET'),
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.status
  }
  const publicStatus = await status('/.netlify/functions/health')
  const protectedUnauthenticatedStatus = await status('/.netlify/functions/release-runtime-health')
  return {
    public: { path: '/.netlify/functions/health', status: publicStatus, passed: publicStatus === 200 },
    protectedUnauthenticated: { path: '/.netlify/functions/release-runtime-health', status: protectedUnauthenticatedStatus, passed: protectedUnauthenticatedStatus === 401 },
  }
}

async function loadEntryAssets(baseUrl, timeoutMs) {
  const response = await fetch(`${baseUrl}/`, { method: assertReadOnlyMethod('GET'), signal: AbortSignal.timeout(timeoutMs) })
  const html = await response.text()
  return new Set([...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map((match) => sanitizeUrl(match[1], baseUrl)))
}

async function runBrowserSmoke(options, cdpUrl, entryAssets) {
  const { session, targetId } = await createPage(cdpUrl, options.timeoutMs)
  const consoleFailures = []
  const failedRequests = []
  const blockedMutations = []
  const requestUrls = new Map()
  let activeRoute = null
  let routeResources = []

  session.on('Runtime.consoleAPICalled', (params) => {
    if (['error', 'assert'].includes(params.type)) consoleFailures.push({ route: activeRoute, ...consoleFailure(params, options.baseUrl) })
  })
  session.on('Runtime.exceptionThrown', (params) => {
    consoleFailures.push({ route: activeRoute, ...consoleFailure({
      type: 'exception',
      args: [{ value: params.exceptionDetails?.text ?? 'exception' }],
      stackTrace: params.exceptionDetails?.stackTrace,
    }, options.baseUrl) })
  })
  session.on('Network.requestWillBeSent', (params) => requestUrls.set(params.requestId, params.request.url))
  session.on('Network.responseReceived', (params) => {
    const record = { route: activeRoute, url: sanitizeUrl(params.response.url, options.baseUrl), status: params.response.status, type: params.type }
    if (params.response.status >= 400) failedRequests.push(record)
    if (activeRoute) routeResources.push(record)
  })
  session.on('Network.loadingFailed', (params) => {
    if (params.blockedReason === 'inspector' || params.canceled) return
    failedRequests.push({ route: activeRoute, url: sanitizeUrl(requestUrls.get(params.requestId) ?? '', options.baseUrl), status: null, type: params.type, reason: cleanText(params.errorText) })
  })
  session.on('Fetch.requestPaused', async (params) => {
    const method = String(params.request.method).toUpperCase()
    if (!READ_ONLY_METHODS.includes(method)) {
      blockedMutations.push({ route: activeRoute, method, url: sanitizeUrl(params.request.url, options.baseUrl) })
      await session.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' })
      return
    }
    await session.send('Fetch.continueRequest', { requestId: params.requestId })
  })

  try {
    await Promise.all([
      session.send('Page.enable'),
      session.send('Runtime.enable'),
      session.send('Network.enable'),
      session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }),
      session.send('Network.setCacheDisabled', { cacheDisabled: true }),
    ])
    activeRoute = '/dashboard'
    await navigateAndWait(session, `${options.baseUrl}/dashboard`)
    const authState = await waitForWorkspace(session, 'Dashboard', options.timeoutMs)
    if (!authState?.authenticated) {
      return { authenticated: false, protectedHealth: { status: null, passed: false }, routes: [], consoleFailures, failedRequests, blockedMutations }
    }

    const protectedHealth = await evaluate(session, `(async () => { try { const response = await fetch('/.netlify/functions/release-runtime-health', { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } }); return { status: response.status, passed: response.status === 200 }; } catch { return { status: null, passed: false }; } })()`)
    const routes = []
    for (const route of workspaceRoutes) {
      activeRoute = route.path
      routeResources = []
      const beforeFailures = failedRequests.length
      const beforeConsole = consoleFailures.length
      const beforeBlocked = blockedMutations.length
      await navigateAndWait(session, `${options.baseUrl}${route.path}`)
      const navigationState = await waitForWorkspace(session, route.label, options.timeoutMs)
      await reloadAndWait(session)
      const refreshState = await waitForWorkspace(session, route.label, options.timeoutMs)
      const scripts = [...new Set(routeResources.filter((resource) => resource.type === 'Script' && resource.status >= 200 && resource.status < 400).map((resource) => resource.url))]
      const lazyAssets = scripts.filter((asset) => !entryAssets.has(asset))
      const documentStatuses = routeResources.filter((resource) => resource.type === 'Document').map((resource) => resource.status)
      routes.push({
        route: route.path,
        expectedWorkspace: route.label,
        navigationRendered: navigationState?.label === route.label && !navigationState?.routeError,
        refreshRendered: refreshState?.label === route.label && !refreshState?.routeError,
        documentStatuses,
        scriptAssetCount: scripts.length,
        lazyAssetCount: lazyAssets.length,
        httpFailureCount: failedRequests.length - beforeFailures,
        consoleFailureCount: consoleFailures.length - beforeConsole,
        blockedMutationCount: blockedMutations.length - beforeBlocked,
      })
    }
    return { authenticated: true, protectedHealth, routes, consoleFailures, failedRequests, blockedMutations }
  } finally {
    await closePage(cdpUrl, targetId, session, options.timeoutMs)
  }
}

export function summarizeSmoke({ health, browser }) {
  const routeFailures = browser.routes.filter((route) => !route.navigationRendered
    || !route.refreshRendered
    || route.documentStatuses?.length !== 2
    || route.documentStatuses.some((status) => status < 200 || status >= 400)
    || route.lazyAssetCount < 1
    || route.httpFailureCount > 0
    || route.consoleFailureCount > 0
    || route.blockedMutationCount > 0)
  const passed = health.public.passed
    && health.protectedUnauthenticated.passed
    && browser.authenticated
    && browser.protectedHealth.passed
    && routeFailures.length === 0
    && browser.consoleFailures.length === 0
    && browser.failedRequests.length === 0
    && browser.blockedMutations.length === 0
  return {
    passed,
    productionProof: passed ? 'COMPLETE' : 'PENDING',
    authenticatedWorkspace: browser.authenticated ? 'verified' : 'unavailable',
    routeCount: browser.routes.length,
    routeFailureCount: routeFailures.length,
    consoleFailureCount: browser.consoleFailures.length,
    failedRequestCount: browser.failedRequests.length,
    blockedMutationCount: browser.blockedMutations.length,
  }
}

export async function runProductionSmoke(options) {
  const startedAt = new Date().toISOString()
  const health = await probeHealth(options.baseUrl, options.timeoutMs)
  const entryAssets = await loadEntryAssets(options.baseUrl, options.timeoutMs)
  const launched = options.cdpUrl ? null : await launchBrowser(options)
  const cdpUrl = String(options.cdpUrl ?? launched.cdpUrl).replace(/\/$/, '')
  try {
    await waitForCdp(cdpUrl, options.timeoutMs)
    const browser = await runBrowserSmoke(options, cdpUrl, entryAssets)
    const summary = summarizeSmoke({ health, browser })
    return sanitizeEvidence({
      schemaVersion: 'atlas-production-smoke-v1',
      startedAt,
      completedAt: new Date().toISOString(),
      target: options.baseUrl,
      safety: {
        mode: 'read-only',
        allowedMethods: READ_ONLY_METHODS,
        nonReadOnlyRequests: 'blocked-before-network',
        sensitiveMaterialPersisted: false,
        responseBodiesPersisted: false,
      },
      health,
      auth: { authenticatedWorkspace: browser.authenticated, protectedHealth: browser.protectedHealth },
      routes: browser.routes,
      failures: { http: browser.failedRequests, console: browser.consoleFailures, blockedMutations: browser.blockedMutations },
      summary,
    }, '', options.baseUrl)
  } finally {
    await launched?.close()
  }
}

async function main() {
  const options = parseArguments()
  let evidence
  try {
    evidence = await runProductionSmoke(options)
  } catch (error) {
    evidence = sanitizeEvidence({
      schemaVersion: 'atlas-production-smoke-v1',
      completedAt: new Date().toISOString(),
      target: options.baseUrl,
      summary: { passed: false, productionProof: 'PENDING' },
      blocker: cleanText(error instanceof Error ? error.message : error),
    }, '', options.baseUrl)
  }
  const defaultName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const outputPath = resolve(options.output ?? join('artifacts', 'production-smoke', defaultName))
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  console.log(`Production smoke: ${evidence.summary?.passed ? 'PASS' : 'PENDING'}`)
  console.log(`Sanitized evidence: ${outputPath}`)
  if (!evidence.summary?.passed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
