import { createRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createOrderRepository() {
  return {
    create(data) {
      return createRecord('orders', {
        type: 'order',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('orders', id, updater)
    },

    list() {
      return listRecords('orders')
    },

    find(id) {
      return findRecord('orders', id)
    },
  }
}
