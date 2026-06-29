import { createRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createPortfolioRepository() {
  return {
    create(data) {
      return createRecord('portfolios', {
        type: 'portfolio',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('portfolios', id, updater)
    },

    list() {
      return listRecords('portfolios')
    },

    find(id) {
      return findRecord('portfolios', id)
    },
  }
}
