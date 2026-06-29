import { createRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createMarketRepository() {
  return {
    create(data) {
      return createRecord('markets', {
        type: 'market',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('markets', id, updater)
    },

    list() {
      return listRecords('markets')
    },

    find(id) {
      return findRecord('markets', id)
    },
  }
}
