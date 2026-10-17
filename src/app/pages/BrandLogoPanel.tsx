import { useState, type ChangeEvent } from 'react'
import { ImageUp, Trash2 } from 'lucide-react'
import { deleteBusinessLogo, uploadBusinessLogo, validateBusinessLogoFile } from '../../lib/businessLogo'
import { useAuth } from '../contexts'
import { BusinessLogo } from '../BusinessLogo'
import { Panel } from '../shared'
import './brand-logo-panel.css'

export function BrandLogoPanel() {
  const { session, setSession } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  if (!session) return null

  const update = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateBusinessLogoFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await uploadBusinessLogo(file)
      setSession({ ...session, business: { ...session.business, logoUrl: result.logoUrl } })
      setNotice('Logo atualizada na página de agendamento.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar a imagem.')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await deleteBusinessLogo()
      setSession({ ...session, business: { ...session.business, logoUrl: null } })
      setNotice('Logo removida. Os ícones voltarão a mostrar as iniciais.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível remover a logo.')
    } finally { setBusy(false) }
  }

  return <Panel className="brand-logo-panel">
    <div className="panel-heading"><div><span className="eyebrow">SUA MARCA</span><h2>Logo do espaço</h2></div></div>
    <div className="brand-logo-content">
      <BusinessLogo name={session.business.name} logoUrl={session.business.logoUrl} className="business-logo-settings" />
      <div className="brand-logo-copy">
        <p>Sua logo aparece no ícone do perfil, no painel e na página de agendamento das clientes. Use uma imagem nítida, preferencialmente quadrada.</p>
        <small>PNG, JPEG ou WebP · até 1 MB. O envio salva a imagem imediatamente.</small>
        <div className="brand-logo-actions">
          <label className={`btn btn-secondary ${busy ? 'brand-logo-busy' : ''}`}>
            <ImageUp size={17}/>{busy ? 'Atualizando...' : session.business.logoUrl ? 'Trocar logo' : 'Adicionar logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void update(event)} disabled={busy} />
          </label>
          {session.business.logoUrl ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void remove()}><Trash2 size={16}/> Remover</button> : null}
        </div>
      </div>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="form-success" role="status">{notice}</p> : null}
  </Panel>
}
