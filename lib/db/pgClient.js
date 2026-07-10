import pg from 'pg'

export function createPgClient({ connectionString } = {}) {
  if (!connectionString) {
    return {
      connected: false,
      async query() {
        return { rows: [] }
      },
      async end() {},
    }
  }

  const client = new pg.Client({ connectionString })
  return {
    connected: true,
    client,
    async connect() {
      if (!this.client._connected) {
        await this.client.connect()
        this.client._connected = true
      }
    },
    async query(text, params = []) {
      await this.connect()
      return this.client.query(text, params)
    },
    async end() {
      await this.client.end()
    },
  }
}

export function createPgPoolClient({
  connectionString,
  max = 5,
  idleTimeoutMillis = 30_000,
  connectionTimeoutMillis = 5_000,
} = {}) {
  if (!connectionString) {
    return {
      connected: false,
      pool: null,
      async query() {
        return { rows: [], rowCount: 0 }
      },
      async connect() {
        return {
          query: async () => ({ rows: [], rowCount: 0 }),
          release() {},
        }
      },
      async end() {},
    }
  }

  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  })

  return {
    connected: true,
    pool,
    async query(text, params = []) {
      return pool.query(text, params)
    },
    async connect() {
      return pool.connect()
    },
    async end() {
      await pool.end()
    },
  }
}
