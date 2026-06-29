import { createDocumentStore } from './documentStore.js'
import { createErrorContract } from '../validation/errorContract.js'

export function createPersistenceService(pgClient) {
  const stores = {
    orders: createDocumentStore(pgClient, 'atlas_orders'),
    positions: createDocumentStore(pgClient, 'atlas_positions'),
    journal: createDocumentStore(pgClient, 'atlas_journal'),
    events: createDocumentStore(pgClient, 'atlas_events'),
    alerts: createDocumentStore(pgClient, 'atlas_alerts'),
    sessions: createDocumentStore(pgClient, 'atlas_sessions'),
    workspaces: createDocumentStore(pgClient, 'atlas_workspaces'),
    systemState: createDocumentStore(pgClient, 'atlas_system_state'),
  }

  return {
    async initialize() {
      if (!pgClient?.connected) {
        return { ok: true, disabled: true }
      }

      try {
        await pgClient.query('SELECT 1')
        return { ok: true, connected: true }
      } catch (error) {
        return createErrorContract('db_init_failed', error?.message ?? 'database initialization failed', error)
      }
    },

    getStore(name) {
      return stores[name] ?? null
    },

    async upsertDocument(name, id, payload) {
      const store = this.getStore(name)
      if (!store) {
        return createErrorContract('db_store_not_found', `store ${name} was not found`)
      }

      return store.upsert(id, payload)
    },

    async listDocuments(name) {
      const store = this.getStore(name)
      if (!store) {
        return []
      }

      return store.list()
    },

    async getDocument(name, id) {
      const store = this.getStore(name)
      if (!store) {
        return null
      }

      return store.get(id)
    },

    async deleteDocument(name, id) {
      const store = this.getStore(name)
      if (!store) {
        return { ok: true, removed: false }
      }

      return store.delete(id)
    },
  }
}
