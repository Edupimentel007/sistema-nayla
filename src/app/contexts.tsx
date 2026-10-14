import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Session } from '../lib/api'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  setSession: (session: Session | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    try { setSession(await api.me()) } catch { setSession(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const logout = useCallback(async () => { await api.logout(); setSession(null) }, [])
  const value = useMemo(() => ({ session, loading, setSession, refresh, logout }), [session, loading, refresh, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa de AuthProvider')
  return context
}

type ThemeContextValue = { theme: 'light' | 'dark'; toggleTheme: () => void }
const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('nayla-theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('nayla-theme', theme) }, [theme])
  const value = useMemo(() => ({ theme, toggleTheme: () => setTheme(current => current === 'light' ? 'dark' : 'light') }), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme precisa de ThemeProvider')
  return context
}
