import { createErrorContract } from '../validation/errorContract.js'

export function createDocumentStore(pgClient, tableName) {
  return {
    async upsert(id, payload) {
      if (!pgClient?.connected) {
        return { ok: true, data: { id, payload }, disabled: true }
      }

      try {
        const result = await pgClient.query(
          `INSERT INTO ${tableName} (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW() RETURNING id, payload`,
          [id, payload],
        )
        const row = result?.rows?.[0] ?? { id, payload }
        return { ok: true, data: row }
      } catch (error) {
        return createErrorContract('db_upsert_failed', error?.message ?? 'database upsert failed', error)
      }
    },

    async list() {
      if (!pgClient?.connected) {
        return []
      }

      try {
        const result = await pgClient.query(`SELECT id, payload FROM ${tableName} ORDER BY updated_at DESC`)
        return result.rows
      } catch (error) {
        return []
      }
    },

    async get(id) {
      if (!pgClient?.connected) {
        return null
      }

      try {
        const result = await pgClient.query(`SELECT id, payload FROM ${tableName} WHERE id = $1`, [id])
        return result.rows[0] ?? null
      } catch (error) {
        return null
      }
    },

    async delete(id) {
      if (!pgClient?.connected) {
        return { ok: true, removed: false, disabled: true }
      }

      try {
        const result = await pgClient.query(`DELETE FROM ${tableName} WHERE id = $1 RETURNING id`, [id])
        return { ok: true, removed: result.rowCount > 0 }
      } catch (error) {
        return createErrorContract('db_delete_failed', error?.message ?? 'database delete failed', error)
      }
    },
  }
}
