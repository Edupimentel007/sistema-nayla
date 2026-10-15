import { useEffect, useState, type FormEvent } from 'react'
import { Check, MessageCircle } from 'lucide-react'
import { api, type ClientSession } from '../../lib/api'
import { Panel } from '../shared'

export function ClientWhatsAppPreference({ slug, client, onUpdated }: { slug: string; client: ClientSession; onUpdated: (value: ClientSession) => void }) {
  const [optIn, setOptIn] = useState(Boolean(client.client.whatsappOptIn))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setOptIn(Boolean(client.client.whatsappOptIn)) }, [client.client.whatsappOptIn])
  const changed = optIn !== Boolean(client.client.whatsappOptIn)
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setSaved(false)
    try { const updated = await api.updateClientPreferences(slug, optIn); onUpdated(updated); setSaved(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar sua preferência.') }
    finally { setSaving(false) }
  }
  return <Panel className="client-preference-panel"><div className="client-preference-icon"><MessageCircle size={22}/></div><div className="client-preference-body"><h2>Mensagens pelo WhatsApp</h2><p>Escolha se deseja receber confirmações automáticas no seu telefone. Você também pode decidir isso em cada novo agendamento.</p><form onSubmit={save}><label className="whatsapp-opt-in"><input type="checkbox" checked={optIn} onChange={event => { setOptIn(event.target.checked); setSaved(false) }}/><span><strong>Autorizo confirmações de agendamento pelo WhatsApp</strong><small>Esta preferência vale para futuros agendamentos neste espaço.</small></span></label>{changed ? <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar preferência'}</button> : null}{saved ? <span className="form-success" role="status"><Check size={16}/> Preferência salva.</span> : null}{error ? <span className="form-error" role="alert">{error}</span> : null}</form></div></Panel>
}
