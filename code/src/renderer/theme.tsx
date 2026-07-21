import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemeMode, 'system'>

const THEME_STORAGE_KEY = 'moonmeter.appearance.v1'
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

type ThemeContextValue = {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  cycleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function resolveThemeMode(mode: ThemeMode, prefersDark?: boolean): ResolvedTheme {
  if (mode !== 'system') return mode
  const dark =
    prefersDark ??
    (typeof window !== 'undefined' && window.matchMedia?.(DARK_MODE_QUERY).matches === true)
  return dark ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemeMode(mode))

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode)
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode)
  }, [])

  const cycleMode = useCallback(() => {
    setMode(mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system')
  }, [mode, setMode])

  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY)
    const apply = () => setResolvedTheme(resolveThemeMode(mode, media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themeMode = mode
    document.documentElement.style.colorScheme = resolvedTheme
  }, [mode, resolvedTheme])

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode, cycleMode }),
    [cycleMode, mode, resolvedTheme, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

export const themeStorageKey = THEME_STORAGE_KEY
