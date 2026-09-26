import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'

export interface OpenTab {
  id: string
  name: string
}

const STORAGE_KEY = 'sheet:open-tabs'
const EVENT_KEY = 'sheet:open-tabs-changed'

export function getStoredTabs(): OpenTab[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is OpenTab =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.name === 'string',
      )
    }
  } catch {
    // ignore parse error
  }
  return []
}

export function saveStoredTabs(tabs: OpenTab[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
    window.dispatchEvent(new Event(EVENT_KEY))
  } catch {
    // ignore write error
  }
}

export function useOpenTabs(activeDocument?: { id: string; name: string }) {
  const [tabs, setTabs] = useState<OpenTab[]>(() => getStoredTabs())
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Sync tabs from storage
  useEffect(() => {
    const update = () => setTabs(getStoredTabs())
    window.addEventListener(EVENT_KEY, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(EVENT_KEY, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  // When activeDocument changes, ensure it's in the open tabs
  useEffect(() => {
    if (!activeDocument?.id) return
    const current = getStoredTabs()
    const index = current.findIndex((item) => item.id === activeDocument.id)
    if (index >= 0) {
      if (current[index]!.name !== activeDocument.name && activeDocument.name) {
        current[index]!.name = activeDocument.name
        saveStoredTabs([...current])
      }
    } else {
      saveStoredTabs([...current, { id: activeDocument.id, name: activeDocument.name || 'Untitled' }])
    }
  }, [activeDocument?.id, activeDocument?.name])

  const closeTab = (id: string) => {
    const current = getStoredTabs()
    const remaining = current.filter((item) => item.id !== id)
    saveStoredTabs(remaining)
    setTabs(remaining)

    // If closing active tab, navigate to next available or /app
    if (pathname.includes(id)) {
      if (remaining.length > 0) {
        const next = remaining.at(-1)!
        void navigate({ to: '/design/$id', params: { id: next.id } })
      } else {
        void navigate({ to: '/app' })
      }
    }
  }

  return {
    tabs,
    closeTab,
  }
}
