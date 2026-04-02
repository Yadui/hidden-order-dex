import { useState } from 'react'

/**
 * Drop-in replacement for useState that also persists to localStorage.
 * On mount, reads the stored value; on set, writes it back.
 */
export function useLocalStorage(key, initialValue) {
  const [state, setRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? JSON.parse(stored) : initialValue
    } catch {
      return initialValue
    }
  })

  function setState(value) {
    const next = typeof value === 'function' ? value(state) : value
    setRaw(next)
    try {
      if (next === null || next === undefined) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(next))
      }
    } catch {}
  }

  return [state, setState]
}
