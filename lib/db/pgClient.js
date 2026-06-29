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
