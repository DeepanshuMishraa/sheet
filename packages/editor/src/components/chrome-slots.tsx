import { createContext, useContext } from 'react'

/**
 * Two places in the app's tab bar that a screen can fill: `leading`, beside the
 * window controls, and `trailing`, at the far end. The shell owns the bar and
 * provides the elements; the editor portals its own controls into them, so
 * Export and the panel switches live in the tab bar instead of a second strip.
 * Without a shell (tests, embedding) both are null and the editor draws its own
 * header.
 */
export interface ChromeSlots {
  leading: HTMLElement | null
  trailing: HTMLElement | null
}

export const ChromeSlotsContext = createContext<ChromeSlots>({
  leading: null,
  trailing: null,
})

export const useChromeSlots = () => useContext(ChromeSlotsContext)
