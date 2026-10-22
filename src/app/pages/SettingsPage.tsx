import { useState, type FormEvent } from 'react'
import { Check, Copy, ExternalLink, Link2, LockKeyhole, Settings2, Share2 } from 'lucide-react'
import { Share } from '@capacitor/share'
import { useNavigate } from 'react-router-dom'
import { api, type Specialty } from '../../lib/api'
import { publicBookingLink } from '../../lib/appOrigin'
import { isNativeApp } from '../../lib/nativeSession'
import { useAuth } from '../contexts'
import { PageHeading, Panel } from '../shared'
import { SpecialtySelector } from '../SpecialtySelector'
import { NotificationHistory, WhatsAppSettings } from './WhatsAppSettings'
import { DeleteAccountPanel } from './DeleteAccountPanel'
import { BrandLogoPanel } from './BrandLogoPanel'
import './admin-motion.css'
import './change-password.css'

const weekdays = [{ value: 0, label: 'Dom' }, { value: 1, label: 'Seg' }, { value: 2, label: 'Ter' }, { value: 3, label: 'Qua' }, { value: 4, label: 'Qui' }, { value: 5, label: 'Sex' }, { value: 6, label: 'Sáb' }]

export function SettingsPage() {
  const { session, setSession } = useAuth()
  const navigate = useNavigate()
  const business = session!.business
  const [name, setName] = useState(business.name)
  const [description, setDescription] = useState(business.description ?? '')
  const [phone, setPhone] = useState(business.phone ?? '')
  const [address, setAddress] = useState(business.address ?? '')
  const [startTime, setStartTime] = useState(business.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(business.endTime ?? '18:00')
  const [workdays, setWorkdays] = useState<number[]>(business.workdays ?? [1, 2, 3, 4, 5, 6])
  const [slotInterval, setSlotInterval] = useState(String(business.slotInterval ?? 30))
  const [selected, setSelected] = useState<Specialty[]>(business.specialties ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = publicBookingLink(business.slug)
  const toggleDay = (day: number) => setWorkdays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day].sort())
  const toggleSpecialty = (item: Specialty) => setSelected(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])
  const copy = async () => { if (!link) { setError('O endereço público do agendamento ainda não está disponível neste dispositivo.'); return } try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500) } catch { setError('Não foi possível copiar o link. Selecione e copie manualmente.') } }
  const share = async () => { if (!link) { setError('Configure o endereço público do app antes de compartilhar.'); return } try { if (isNativeApp) await Share.share({ title: `Agende com ${business.name}`, text: `Escolha seu horário com ${business.name}`, url: link }); else if (navigator.share) await navigator.share({ title: `Agende com ${business.name}`, url: link }); else await copy() } catch { /* compartilhar pode ser cancelado pela usuária */ } }
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!workdays.length || !selected.length) { setError('Selecione pelo menos um dia de atendimento e uma área.'); return } setSaving(true); setError(''); setSuccess(false); try { const updated = await api.updateBusiness({ name: name.trim(), description: description.trim(), phone: phone.trim(), address: address.trim(), startTime, endTime, workdays, slotInterval: Number(slotInterval), specialties: selected }); setSession({ ...session!, business: updated }); setSuccess(true) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar suas configurações.') } finally { setSaving(false) } }
  const accountDeleted = () => { setSession(null); navigate('/', { replace: true }) }
  return <div className="page"><PageHeading eyebrow="SEU ESPAÇO" title="Configurações" description="Deixe sua página com a sua cara e escolha quando receber agendamentos." /><Panel className="booking-link-panel"><div className="booking-link-icon"><Link2 size={22}/></div><div><span className="eyebrow">SEU LINK DE AGENDAMENTO</span><h2>Pronto para compartilhar</h2><p>Envie este link para suas clientes agendarem diretamente com você.</p><div className="copy-field"><input value={link} readOnly aria-label="Link de agendamento" onFocus={event => event.target.select()} /><button onClick={copy}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? 'Copiado' : 'Copiar'}</button></div><button className="subtle-link share-booking" type="button" onClick={() => void share()} disabled={!link}><Share2 size={16}/> Compartilhar link</button></div><a className="icon-button link-preview" href={link || undefined} target="_blank" rel="noreferrer" title="Visualizar página" aria-label="Visualizar página"><ExternalLink size={20}/></a></Panel><BrandLogoPanel/><form onSubmit={submit} className="settings-form"><Panel><div className="panel-heading"><div><span className="eyebrow">IDENTIDADE</span><h2>Sobre seu espaço</h2></div><Settings2 size={21}/></div><div className="form-stack"><label>Nome do espaço<input value={name} onChange={e => setName(e.target.value)} required /></label><label>Descrição para suas clientes<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Conte o que faz seu atendimento especial" /></label><div className="form-row"><label>Telefone ou WhatsApp<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /></label><label>Endereço ou local de atendimento<input value={address} onChange={e => setAddress(e.target.value)} placeholder="Bairro, cidade ou endereço" /></label></div><SpecialtySelector legend="Áreas de atuação" selected={selected} onToggle={toggleSpecialty} hint="Serviços de áreas removidas deixam de aparecer para agendamento. Escolha Outra especialidade para cadastrar serviços de outra área." /></div></Panel><Panel><div className="panel-heading"><div><span className="eyebrow">AGENDA ONLINE</span><h2>Disponibilidade</h2></div></div><div className="form-stack"><div className="form-row"><label>Início dos atendimentos<input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required /></label><label>Fim dos atendimentos<input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required /></label></div><fieldset className="specialty-field"><legend>Dias de atendimento</legend><div className="weekday-options">{weekdays.map(day => <button type="button" key={day.value} className={workdays.includes(day.value) ? 'selected' : ''} aria-pressed={workdays.includes(day.value)} onClick={() => toggleDay(day.value)}>{day.label}</button>)}</div><label>Intervalo entre horários<select value={slotInterval} onChange={e => setSlotInterval(e.target.value)}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60">60 minutos</option></select></label></fieldset></div></Panel>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status"><Check size={16}/> Suas alterações foram salvas.</p> : null}<div className="settings-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar configurações'}</button></div></form><WhatsAppSettings/><NotificationHistory/><ChangePasswordPanel onChanged={() => { setSession(null); navigate('/entrar', { replace: true }) }}/><DeleteAccountPanel kind="owner" onDeleted={accountDeleted}/></div>
}

function ChangePasswordPanel({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (newPassword.length < 12 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('A nova senha precisa ter pelo menos 12 caracteres, letras e números.')
      return
    }
    if (newPassword === currentPassword) {
      setError('Escolha uma senha diferente da atual.')
      return
    }
    if (newPassword !== confirmation) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }
    setBusy(true)
    try {
      await api.changeOwnerPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      onChanged()
    } catch (reason) {
      setCurrentPassword('')
      setError(reason instanceof Error ? reason.message : 'Não foi possível trocar sua senha. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return <Panel className="change-password-panel">
    <div className="change-password-header">
      <span className="change-password-icon" aria-hidden="true"><LockKeyhole size={20}/></span>
      <div><span className="eyebrow">SEGURANÇA DA CONTA</span><h2>Trocar senha</h2>
        <p>Use uma senha exclusiva para a Nayla. A troca encerra o acesso em todos os dispositivos.</p></div>
    </div>
    <form className="form-stack change-password-form" onSubmit={event => void submit(event)}>
      <label>Senha atual<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}
        autoComplete="current-password" autoCapitalize="none" spellCheck={false} disabled={busy} required /></label>
      <div className="form-row">
        <label>Nova senha<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)}
          autoComplete="new-password" autoCapitalize="none" spellCheck={false} minLength={12} maxLength={100} disabled={busy} required
          aria-describedby="change-password-hint" /></label>
        <label>Confirme a nova senha<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)}
          autoComplete="new-password" autoCapitalize="none" spellCheck={false} minLength={12} maxLength={100} disabled={busy} required /></label>
      </div>
      <p className="change-password-hint" id="change-password-hint">Pelo menos 12 caracteres, com letras e números. Uma frase longa e única é uma boa opção.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="change-password-actions"><button className="btn btn-primary" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmation}>
        {busy ? 'Trocando senha...' : 'Trocar senha e entrar novamente'}
      </button></div>
    </form>
  </Panel>
}
