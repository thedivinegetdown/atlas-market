import { createId } from '../core/id.js'

const state = {
  orders: [],
  portfolios: [],
  journals: [],
  markets: [],
  risks: [],
  events: [],
  alerts: [],
  scanners: [],
}

export function resetStore() {
  state.orders = []
  state.portfolios = []
  state.journals = []
  state.markets = []
  state.risks = []
  state.events = []
  state.alerts = []
  state.scanners = []
}

export function getStore() {
  return state
}

export function createRecord(collectionName, data) {
  const record = {
    id: data.id ?? createId(collectionName),
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: data.updatedAt ?? Date.now(),
    ...data,
  }

  state[collectionName].push(record)
  return record
}

export function updateRecord(collectionName, id, updater) {
  const index = state[collectionName].findIndex((entry) => entry.id === id)
  if (index === -1) {
    return null
  }

  const current = state[collectionName][index]
  const updated = {
    ...current,
    ...updater(current),
    id,
    updatedAt: Date.now(),
  }

  state[collectionName][index] = updated
  return updated
}

export function deleteRecord(collectionName, id) {
  const index = state[collectionName].findIndex((entry) => entry.id === id)
  if (index === -1) {
    return false
  }

  state[collectionName].splice(index, 1)
  return true
}

export function listRecords(collectionName) {
  return [...state[collectionName]]
}

export function findRecord(collectionName, id) {
  return state[collectionName].find((entry) => entry.id === id) ?? null
}
