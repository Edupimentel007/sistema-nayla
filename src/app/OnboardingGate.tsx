import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { Loading, Logo } from './shared'
import './pages/onboarding.css'

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; completed: boolean; accessGranted: boolean; error: string }>({ loading: true, completed: false, accessGranted: false, error: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    api.subscription().then(subscription => {
      if (active) setState({ loading: false, completed: subscription.onboardingCompleted,
        accessGranted: subscription.accessGranted, error: '' })
    }).catch(error => {
      if (active) setState({ loading: false, completed: false, accessGranted: false,
        error: error instanceof Error ? error.message : 'Tente novamente.' })
    })
    return () => { active = false }
  }, [retry])
  if (state.loading) return <main className="center-screen"><Loading label="Preparando seu espaço..." /></main>
  if (state.error) return <main className="center-screen onboarding-load-error"><Logo />
    <p role="alert">Não conseguimos verificar seu acesso: {state.error}</p>
    <button className="btn btn-primary" type="button" onClick={() => {
      setState({ loading: true, completed: false, accessGranted: false, error: '' }); setRetry(value => value + 1)
    }}><RefreshCw size={16} /> Tentar novamente</button>
  </main>
  if (!state.completed || !state.accessGranted) return <Navigate to="/app/boas-vindas" replace />
  return children
}
