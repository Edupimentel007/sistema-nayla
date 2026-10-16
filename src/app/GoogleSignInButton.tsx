import { useEffect, useState } from 'react'
import { api, type GoogleCompletion } from '../lib/api'
import { beginGoogleLogin } from '../lib/googleAuth'
import type { SessionRole } from '../lib/nativeSession'
import './google-sign-in.css'

export function GoogleSignInButton({ role, slug, remember, onResult, onError }: {
  role: SessionRole
  slug?: string
  remember: boolean
  onResult: (result: GoogleCompletion) => void
  onError: (message: string) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; api.googleConfig().then(result => {
    if (live) setEnabled(result.enabled)
  }).catch(() => {}); return () => { live = false } }, [])
  if (!enabled) return null
  const start = async () => {
    setBusy(true)
    try { const result = await beginGoogleLogin(role, remember, slug); if (result) onResult(result) }
    catch (error) { onError(error instanceof Error ? error.message : 'Não foi possível entrar com Google.') }
    finally { setBusy(false) }
  }
  return <div className="google-sign-in"><span className="google-divider">ou</span>
    <button className="btn btn-secondary btn-full google-button" type="button" onClick={() => void start()} disabled={busy}>
      <span className="google-g" aria-hidden="true">G</span>{busy ? 'Abrindo Google...' : 'Continuar com Google'}
    </button></div>
}
