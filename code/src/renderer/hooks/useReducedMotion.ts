import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPreference)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)

    setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
