import { useEffect, useState } from 'react'

let currentQuery = ''
const listeners = new Set<(q: string) => void>()

export function setDashboardSearchQuery(query: string) {
  currentQuery = query
  for (const listener of listeners) {
    listener(query)
  }
}

export function resetDashboardSearchQuery() {
  setDashboardSearchQuery('')
}

export function useDashboardSearchQuery() {
  const [query, setQuery] = useState(currentQuery)
  useEffect(() => {
    listeners.add(setQuery)
    return () => {
      listeners.delete(setQuery)
    }
  }, [])
  return [query, setDashboardSearchQuery] as const
}
