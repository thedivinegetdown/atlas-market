import { useEffect, useState } from 'react'
import { createJournalRepository } from '../../lib/repositories/journalRepository.js'

const journalRepository = createJournalRepository()

function ensureSeedEntries() {
  const existing = journalRepository.list()
  if (existing.length > 0) {
    return existing
  }

  journalRepository.create({
    strategy: 'Opening Range',
    message: 'Reviewed SPY watchlist conditions before paper order routing.',
    result: 'neutral',
  })
  journalRepository.create({
    strategy: 'Risk Review',
    message: 'Confirmed position sizing remains inside portfolio exposure limits.',
    result: 'neutral',
  })

  return journalRepository.list()
}

export function useJournal() {
  const [entries, setEntries] = useState(() => ensureSeedEntries())

  const refresh = () => {
    setEntries(journalRepository.list())
  }

  useEffect(() => {
    refresh()
  }, [])

  return {
    entries,
    refresh,
  }
}
