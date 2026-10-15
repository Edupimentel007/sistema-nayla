import { useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Check, Clock3, Pencil, Scissors, X } from 'lucide-react'
import { api, type Appointment, type NotificationStatus, type Service } from '../../lib/api'
import { calendarDay, calendarMonth, dateTime, localISODate, money, StatusBadge } from '../shared'
import './client-appointment-card.css'

const notificationNote: Record<NotificationStatus, string> = {
  pending: 'O aviso por WhatsApp está em processamento.',
  opted_out: 'Você optou por não receber avisos pelo WhatsApp.',
  simulated: 'O aviso por WhatsApp foi simulado e não foi enviado.',
  not_configured: 'O WhatsApp da profissional ainda não está configurado para envio automático.',
  accepted: 'O WhatsApp aceitou o aviso. A entrega ainda não foi confirmada.',
  sent: 'O WhatsApp aceitou o aviso. A entrega ainda não foi confirmada.',
  delivered: 'O aviso foi entregue pelo WhatsApp.',
  read: 'O aviso foi lido no WhatsApp.',
  failed: 'Não foi possível enviar o aviso pelo WhatsApp.',
}

type Props = {
  slug: string
  businessName?: string
  item: Appointment
  services: Service[]
  onUpdated: (appointment: Appointment) => void
}

export function ClientAppointmentCard({ slug, businessName, item, services, onUpdated }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [serviceId, setServiceId] = useState(item.serviceId ?? '')
  const [date, setDate] = useState(item.startsAt.slice(0, 10))
  const [time, setTime] = useState(item.startsAt.slice(11, 16))
  const [slots, setSlots] = useState<string[]>([])
  const [slotLoading, setSlotLoading] = useState(false)
  const [slotError, setSlotError] = useState('')
  const [slotRetry, setSlotRetry] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canChange = ['pending', 'confirmed'].includes(item.status) && new Date(item.startsAt).getTime() > Date.now()
  const activeServices = services.filter(service => service.active)
  const changed = serviceId !== item.serviceId || date !== item.startsAt.slice(0, 10) || time !== item.startsAt.slice(11, 16)

  useEffect(() => {
    if (!editing || !slug || !serviceId || !date) return
    let live = true
    setSlotLoading(true)
    setSlotError('')
    setSlots([])
    api.clientAvailability(slug, serviceId, date, item.id)
      .then(result => {
        if (!live) return
        setSlots(result.slots)
        setTime(current => result.slots.includes(current) ? current : '')
      })
      .catch(reason => { if (live) setSlotError(reason instanceof Error ? reason.message : 'Não foi possível consultar os horários.') })
      .finally(() => { if (live) setSlotLoading(false) })
    return () => { live = false }
  }, [editing, slug, serviceId, date, item.id, slotRetry])

  const startEdit = () => {
    setConfirmingCancel(false)
    setSlots([])
    setServiceId(activeServices.some(service => service.id === item.serviceId) ? item.serviceId ?? '' : '')
    setDate(item.startsAt.slice(0, 10))
    setTime(item.startsAt.slice(11, 16))
    setError('')
    setNotice('')
    setEditing(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!serviceId || !date || !time || !slots.includes(time) || !changed) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateClientAppointment(item.id, { serviceId, date, time })
      onUpdated(updated)
      setEditing(false)
      setNotice(`Agendamento atualizado na agenda da profissional. ${notificationNote[updated.notificationStatus]}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o agendamento. Consulte os horários novamente.')
      setSlotRetry(value => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const updated = await api.cancelClientAppointment(slug, item.id, reason)
      onUpdated(updated)
      setConfirmingCancel(false)
      setNotice(`Agendamento cancelado e horário liberado na agenda. ${notificationNote[updated.notificationStatus]}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o agendamento.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="client-appointment-entry">
    <article className="client-appointment-card">
      <span className="client-appointment-date"><strong>{calendarDay(item.startsAt)}</strong><small>{calendarMonth(item.startsAt)}</small></span>
      <div className="client-appointment-info">
        <div><h2>{item.serviceName}</h2><StatusBadge status={item.status}/></div>
        <p><CalendarDays size={16}/> {dateTime(item.startsAt)}</p>
        <p><Scissors size={16}/> {businessName}</p>
      </div>
      <div className="client-appointment-side">
        <strong>{money(item.price)}</strong>
        {canChange ? <div className="client-appointment-actions">
          <button type="button" className="client-appointment-edit-trigger" onClick={startEdit} disabled={busy}><Pencil size={13}/> Editar</button>
          <button type="button" onClick={() => { setEditing(false); setConfirmingCancel(true); setReason(''); setError(''); setNotice('') }} disabled={busy}><X size={13}/> Cancelar</button>
        </div> : null}
      </div>
    </article>

    {editing && canChange ? <form className="client-appointment-editor" onSubmit={save}>
      <div className="client-appointment-form-heading"><h3>Alterar agendamento</h3><p>Escolha outro serviço, dia ou horário. O horário atual fica reservado até você salvar.</p></div>
      <div className="client-appointment-fields">
        <label>Serviço
          <select value={serviceId} onChange={event => { setServiceId(event.target.value); setTime('') }} required>
            <option value="">Escolha um serviço</option>
            {activeServices.map(service => <option value={service.id} key={service.id}>{service.name} · {service.durationMinutes} min · {money(service.price)}</option>)}
          </select>
        </label>
        <label>Dia
          <input type="date" min={localISODate()} value={date} onChange={event => { setDate(event.target.value); setTime('') }} required/>
        </label>
      </div>
      <div className="client-appointment-slot-heading"><Clock3 size={15}/><strong>Horários disponíveis</strong></div>
      {!serviceId ? <p className="client-appointment-help">Escolha um serviço para ver os horários.</p> : slotLoading ? <p className="client-appointment-help">Buscando horários...</p> : slotError ? <div className="client-appointment-inline-error" role="alert">{slotError} <button type="button" onClick={() => setSlotRetry(value => value + 1)}>Tentar novamente</button></div> : slots.length ? <div className="client-appointment-slots">{slots.map(slot => <button type="button" aria-pressed={time === slot} className={time === slot ? 'selected' : ''} key={slot} onClick={() => setTime(slot)}>{slot}</button>)}</div> : <p className="client-appointment-help">Sem horários neste dia. Escolha outra data.</p>}
      {!changed && time ? <p className="client-appointment-help">Altere pelo menos um dado para salvar.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="client-appointment-form-actions"><button className="btn btn-secondary" type="button" onClick={() => setEditing(false)} disabled={busy}>Voltar</button><button className="btn btn-primary" type="submit" disabled={busy || slotLoading || !changed || !slots.includes(time)}>{busy ? 'Salvando...' : 'Salvar alteração'} <Check size={16}/></button></div>
    </form> : null}

    {confirmingCancel && canChange ? <form className="client-appointment-editor" onSubmit={cancel}>
      <div className="client-appointment-form-heading"><h3>Cancelar este horário?</h3><p>O horário será liberado na agenda da profissional. Você poderá fazer outro agendamento depois.</p></div>
      <label className="client-appointment-reason">Motivo (opcional)
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Se quiser, conte o que aconteceu."/>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="client-appointment-form-actions"><button className="btn btn-secondary" type="button" onClick={() => setConfirmingCancel(false)} disabled={busy}>Manter agendamento</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Cancelando...' : 'Confirmar cancelamento'}</button></div>
    </form> : null}

    {notice ? <p className="client-appointment-notice" role="status"><Check size={16}/>{notice}</p> : null}
  </div>
}
