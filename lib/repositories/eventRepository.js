import { createRecord, listRecords } from './store.js'

export function createEventRepository() {
  return {
    append(data) {
      return createRecord('events', {
        type: 'event',
        ...data,
      })
    },

    list() {
      return listRecords('events')
    },
  }
}
