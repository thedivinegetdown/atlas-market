import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const PERFORMANCE_BUDGETS = Object.freeze({
  maxInitialEntryBytes: 505 * 1024,
  maxLargestEagerChunkBytes: 505 * 1024,
  maxTotalEagerJavaScriptBytes: 1900 * 1024,
  requiredDeferredChunkPrefixes: ['atlas-ai-panels', 'release-diagnostics-ui'],
})

export const DESIGNATED_HEAVY_FEATURE_IMPORTS = Object.freeze([
  './components/AtlasCopilotPanel.jsx',
  './components/AtlasOpportunityReviewPanel.jsx',
  './components/AtlasPortfolioIntelligencePanel.jsx',
  './components/ReleaseDiagnosticsPanel.jsx',
])

function unique(values) {
  return [...new Set(values)]
}

export function parseHtmlJavaScriptReferences(html) {
  return unique([...html.matchAll(/(?:src|href)="\/?assets\/([^"]+\.js)"/g)].map((match) => match[1]))
}

export function collectBuildMetrics({ distDir = 'dist' } = {}) {
  const indexPath = join(distDir, 'index.html')
  const assetsDir = join(distDir, 'assets')
  if (!existsSync(indexPath) || !existsSync(assetsDir)) {
    throw new Error('Production build output was not found. Run npm run build first.')
  }

  const html = readFileSync(indexPath, 'utf8')
  const eagerReferences = parseHtmlJavaScriptReferences(html)
  const initialEntryMatch = html.match(/<script[^>]+type="module"[^>]+src="\/?assets\/([^"]+\.js)"/)
  const initialEntryName = initialEntryMatch?.[1] ?? eagerReferences.find((name) => name.startsWith('index-'))
  const chunks = readdirSync(assetsDir)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => {
      const path = join(assetsDir, fileName)
      const source = readFileSync(path)
      return {
        name: fileName,
        bytes: statSync(path).size,
        gzipBytes: gzipSync(source).length,
        eager: eagerReferences.includes(fileName),
        initialEntry: fileName === initialEntryName,
      }
    })
    .sort((a, b) => b.bytes - a.bytes)

  const eagerChunks = chunks.filter((chunk) => chunk.eager)
  const deferredChunks = chunks.filter((chunk) => !chunk.eager)
  const sum = (items, key) => items.reduce((total, item) => total + item[key], 0)
  const largest = (items) => items.reduce((current, item) => (item.bytes > (current?.bytes ?? 0) ? item : current), null)

  return {
    chunkCount: chunks.length,
    totalJavaScriptBytes: sum(chunks, 'bytes'),
    totalJavaScriptGzipBytes: sum(chunks, 'gzipBytes'),
    totalEagerJavaScriptBytes: sum(eagerChunks, 'bytes'),
    totalEagerJavaScriptGzipBytes: sum(eagerChunks, 'gzipBytes'),
    initialEntryChunk: chunks.find((chunk) => chunk.initialEntry) ?? null,
    largestEagerChunk: largest(eagerChunks),
    largestDeferredFeatureChunk: largest(deferredChunks),
    eagerChunks,
    deferredChunks,
    chunks,
  }
}

export function findStaticHeavyFeatureImports(source) {
  return DESIGNATED_HEAVY_FEATURE_IMPORTS.filter((specifier) => {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`import\\s+[^('"\\n]+from\\s+['"]${escaped}['"]`).test(source)
  })
}

export function evaluatePerformanceBudget(metrics, source, budgets = PERFORMANCE_BUDGETS) {
  const failures = []
  const staticImports = findStaticHeavyFeatureImports(source)
  const deferredNames = metrics.deferredChunks.map((chunk) => chunk.name)

  if ((metrics.initialEntryChunk?.bytes ?? 0) > budgets.maxInitialEntryBytes) {
    failures.push(`Initial entry chunk exceeds ${budgets.maxInitialEntryBytes} bytes.`)
  }
  if ((metrics.largestEagerChunk?.bytes ?? 0) > budgets.maxLargestEagerChunkBytes) {
    failures.push(`Largest eager chunk exceeds ${budgets.maxLargestEagerChunkBytes} bytes.`)
  }
  if (metrics.totalEagerJavaScriptBytes > budgets.maxTotalEagerJavaScriptBytes) {
    failures.push(`Total eager JavaScript exceeds ${budgets.maxTotalEagerJavaScriptBytes} bytes.`)
  }
  for (const prefix of budgets.requiredDeferredChunkPrefixes) {
    if (!deferredNames.some((name) => name.startsWith(prefix))) {
      failures.push(`Expected deferred feature chunk ${prefix} was not generated.`)
    }
  }
  for (const specifier of staticImports) {
    failures.push(`Designated heavy feature is eagerly imported: ${specifier}`)
  }

  return {
    ok: failures.length === 0,
    failures,
    staticImports,
  }
}

export function formatMetricBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

export function summarizeMetrics(metrics) {
  return {
    totalJavaScript: formatMetricBytes(metrics.totalJavaScriptBytes),
    totalEagerJavaScript: formatMetricBytes(metrics.totalEagerJavaScriptBytes),
    initialEntryChunk: metrics.initialEntryChunk ? `${metrics.initialEntryChunk.name} ${formatMetricBytes(metrics.initialEntryChunk.bytes)}` : 'missing',
    largestEagerChunk: metrics.largestEagerChunk ? `${metrics.largestEagerChunk.name} ${formatMetricBytes(metrics.largestEagerChunk.bytes)}` : 'missing',
    largestDeferredFeatureChunk: metrics.largestDeferredFeatureChunk ? `${metrics.largestDeferredFeatureChunk.name} ${formatMetricBytes(metrics.largestDeferredFeatureChunk.bytes)}` : 'missing',
    chunkCount: metrics.chunkCount,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const metrics = collectBuildMetrics()
  const appSource = readFileSync('src/App.jsx', 'utf8')
  const result = evaluatePerformanceBudget(metrics, appSource)
  console.log(JSON.stringify({ ...summarizeMetrics(metrics), ok: result.ok, failures: result.failures }, null, 2))
  if (!result.ok) {
    process.exitCode = 1
  }
}
