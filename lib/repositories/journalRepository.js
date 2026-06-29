import { createRecord, listRecords } from './store.js'

export function createJournalRepository() {
  return {
    create(data) {
      return createRecord('journals', {
        type: 'journal',
        ...data,
      })
    },

    list() {
      return listRecords('journals')
    },
  }
}
