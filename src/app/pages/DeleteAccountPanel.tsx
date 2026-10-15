import { useState, type FormEvent } from 'react'
import { ShieldAlert, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Panel } from '../shared'

type AccountKind = 'owner' | 'client'

const accountDetails: Record<AccountKind, { description: string; consequences: string[] }> = {
  owner: {
    description: 'A exclusão encerra seu espaço na Nayla e remove os dados vinculados a ele.',
    consequences: [
      'Seu cadastro e a página de agendamento',
      'Serviços, clientes e agendamentos',
      'Registros financeiros e histórico de mensagens',
    ],
  },
  client: {
    description: 'A exclusão remove sua conta de cliente neste espaço.',
    consequences: [
      'Seus dados pessoais e seu acesso à conta',
      'Seus agendamentos e as mensagens associadas',
      'Os registros financeiros desses agendamentos',
    ],
  },
}

export function DeleteAccountPanel({ kind, onDeleted }: { kind: AccountKind; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const details = accountDetails[kind]
  const formId = `delete-${kind}-account-form`

  const close = () => {
    if (busy) return
    setOpen(false)
    setPassword('')
    setConfirmed(false)
    setError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !password.trim() || !confirmed) return
    setBusy(true)
    setError('')
    try {
      if (kind === 'owner') await api.deleteOwnerAccount(password)
      else await api.deleteClientAccount(password)
      onDeleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a conta. Tente novamente.')
      setBusy(false)
    }
  }

  return <Panel className="account-deletion-panel">
    <div className="account-deletion-summary">
      <span className="account-deletion-icon" aria-hidden="true"><Trash2 size={19}/></span>
      <div>
        <span className="eyebrow">CONTA E DADOS</span>
        <h2>Excluir minha conta</h2>
        <p>{details.description}</p>
      </div>
      <button className="btn account-deletion-open" type="button" aria-expanded={open} aria-controls={formId} onClick={() => open ? close() : setOpen(true)} disabled={busy}>{open ? 'Fechar' : 'Excluir minha conta'}</button>
    </div>
    {open ? <form id={formId} className="account-deletion-form form-stack" onSubmit={event => void submit(event)}>
      <div className="account-deletion-warning"><ShieldAlert size={20}/><div><strong>Esta ação é permanente.</strong><p>Depois de confirmar, não será possível recuperar:</p><ul>{details.consequences.map(item => <li key={item}>{item}</li>)}</ul></div></div>
      <label>Confirme com sua senha<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={busy}/></label>
      <label className="account-deletion-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={busy}/><span>Entendo que esta exclusão é definitiva e quero excluir minha conta e os dados descritos acima.</span></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="account-deletion-actions"><button className="btn btn-secondary" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="btn btn-danger" type="submit" disabled={busy || !password.trim() || !confirmed}>{busy ? 'Excluindo conta...' : 'Excluir conta permanentemente'}</button></div>
    </form> : null}
  </Panel>
}
