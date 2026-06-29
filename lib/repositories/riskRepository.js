import { createRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createRiskRepository() {
  return {
    create(data) {
      return createRecord('risks', {
        type: 'risk',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('risks', id, updater)
    },

    list() {
      return listRecords('risks')
    },

    find(id) {
      return findRecord('risks', id)
    },
  }
}
