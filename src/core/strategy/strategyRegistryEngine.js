import { normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_REGISTRY_UPDATED_EVENT = 'strategy.registry.updated'

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
}

function normalizeId(value, fallback = 'strategy-blueprint') {
  return normalizeText(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeList(values = [], normalizer = (value) => normalizeText(value).toLowerCase()) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizer).filter(Boolean))]
}

function getBlueprint(input = {}) {
  return input.strategyBlueprintValidation?.blueprint ?? input.blueprint ?? {}
}

function getLifecycle(input = {}) {
  return input.strategyLifecycle ?? input.lifecycle ?? {}
}

function getRecordStatus({ blueprintValidationStatus, lifecycleState }) {
  if (lifecycleState === 'archived') return 'archived'
  if (lifecycleState === 'active') return 'active'
  if (lifecycleState === 'paused') return 'paused'
  if (blueprintValidationStatus === 'valid' || blueprintValidationStatus === 'caution' || lifecycleState === 'validated') return 'validated'
  return 'draft'
}

function normalizeRegistryRecord(input = {}, timestamp) {
  const blueprint = input.blueprint ?? getBlueprint(input)
  const lifecycle = input.lifecycle ?? getLifecycle(input)
  const metadata = blueprint.metadata ?? {}
  const strategyId = normalizeId(input.strategyId ?? input.id ?? lifecycle.strategyId ?? blueprint.id, 'strategy-blueprint')
  const strategyName = normalizeText(input.strategyName ?? lifecycle.strategyName ?? blueprint.name, 'Untitled Strategy Blueprint')
  const lifecycleState = normalizeText(input.lifecycleState ?? lifecycle.lifecycleState, 'draft').toLowerCase()
  const validationStatus = input.strategyBlueprintValidation?.validationStatus
    ?? lifecycle.validationSnapshot?.validationStatus
    ?? input.validationStatus
    ?? 'draft'
  const status = normalizeText(input.status, getRecordStatus({
    blueprintValidationStatus: validationStatus,
    lifecycleState,
  })).toLowerCase()

  return {
    id: strategyId,
    strategyId,
    strategyName,
    versionReference: normalizeText(input.versionReference ?? blueprint.version ?? lifecycle.validationSnapshot?.version, '0.1.0'),
    status,
    lifecycleState,
    validationStatus,
    active: status === 'active',
    paused: status === 'paused',
    archived: status === 'archived',
    compatibleAssetClasses: normalizeList(
      input.compatibleAssetClasses ?? blueprint.compatibleAssetClasses ?? lifecycle.validationSnapshot?.compatibleAssetClasses ?? [],
      normalizeAssetType,
    ),
    timeframeReferences: normalizeList(input.timeframeReferences ?? blueprint.timeframeReferences ?? lifecycle.validationSnapshot?.timeframeReferences ?? []),
    tags: normalizeList(metadata.tags ?? input.tags ?? []),
    metadata: {
      owner: normalizeText(input.metadata?.owner ?? metadata.owner, 'Atlas Research'),
      description: normalizeText(input.metadata?.description ?? metadata.description, 'Paper-only reusable strategy blueprint'),
      createdBy: normalizeText(input.metadata?.createdBy ?? metadata.createdBy, 'strategy-builder'),
    },
    lifecycleSummary: lifecycle.summary ?? `${strategyName} lifecycle state is ${lifecycleState}.`,
    activationEligibilityStatus: lifecycle.activationEligibility?.status ?? 'unknown',
    registeredAt: input.registeredAt ?? timestamp,
    updatedAt: timestamp,
    paperTrading: true,
    sourceEvents: {
      strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
      strategyLifecycle: lifecycle.eventType ?? null,
    },
  }
}

function mergeRecords(existingRecords = [], record) {
  const normalizedExisting = existingRecords.map((existing) => normalizeRegistryRecord(existing, existing.updatedAt ?? record.updatedAt))
  const withoutCurrent = normalizedExisting.filter((existing) => existing.strategyId !== record.strategyId)
  return [...withoutCurrent, record].sort((left, right) => left.strategyName.localeCompare(right.strategyName))
}

function filterByStatus(records, status) {
  if (!status) return records
  return records.filter((record) => record.status === normalizeText(status).toLowerCase())
}

function filterByAssetClass(records, assetClass) {
  if (!assetClass) return records
  const normalizedAssetClass = normalizeAssetType(assetClass)
  return records.filter((record) => record.compatibleAssetClasses.includes(normalizedAssetClass))
}

function filterByTimeframe(records, timeframe) {
  if (!timeframe) return records
  const normalizedTimeframe = normalizeText(timeframe).toLowerCase()
  return records.filter((record) => record.timeframeReferences.includes(normalizedTimeframe))
}

function filterByTag(records, tag) {
  if (!tag) return records
  const normalizedTag = normalizeText(tag).toLowerCase()
  return records.filter((record) => record.tags.includes(normalizedTag))
}

function buildLookup(records) {
  return records.reduce((lookup, record) => ({
    ...lookup,
    [record.strategyId]: record,
  }), {})
}

function buildStatusCounts(records) {
  return records.reduce((counts, record) => ({
    ...counts,
    [record.status]: (counts[record.status] ?? 0) + 1,
  }), {})
}

export function updateStrategyRegistry(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const filters = input.filters ?? {}
  const registryRecord = normalizeRegistryRecord(input, timestamp)
  const records = mergeRecords(input.existingRecords ?? input.strategyLibraryCollection?.records ?? [], registryRecord)
  const activeStrategies = records.filter((record) => record.active)
  const statusFilteredStrategies = filterByStatus(records, filters.status)
  const assetClassFilteredStrategies = filterByAssetClass(records, filters.assetClass)
  const timeframeFilteredStrategies = filterByTimeframe(records, filters.timeframe)
  const tagFilteredStrategies = filterByTag(records, filters.tag)
  const activeStrategyLookup = buildLookup(activeStrategies)
  const strategyLibraryCollection = {
    records,
    totalStrategies: records.length,
    activeStrategies,
    statusFilteredStrategies,
    assetClassFilteredStrategies,
    timeframeFilteredStrategies,
    tagFilteredStrategies,
    filters: {
      status: filters.status ?? null,
      assetClass: filters.assetClass ?? null,
      timeframe: filters.timeframe ?? null,
      tag: filters.tag ?? null,
    },
    statusCounts: buildStatusCounts(records),
    paperTrading: true,
  }
  const result = {
    eventType: STRATEGY_REGISTRY_UPDATED_EVENT,
    paperTrading: true,
    timestamp,
    registryRecord,
    strategyLibraryCollection,
    activeStrategyLookup,
    activeStrategyCount: activeStrategies.length,
    summary: `${registryRecord.strategyName} registered as ${registryRecord.status} paper strategy version ${registryRecord.versionReference}.`,
    sourceEvents: registryRecord.sourceEvents,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_REGISTRY_UPDATED_EVENT, result)
  }

  return result
}

export function createStrategyRegistryEngine(options = {}) {
  return {
    update(input, updateOptions = {}) {
      return updateStrategyRegistry(input, { ...options, ...updateOptions })
    },
  }
}
