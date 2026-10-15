import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Filter, Plus, UserRound, X } from 'lucide-react'
import { api, type Appointment, type AppointmentStatus, type NotificationStatus } from '../../lib/api'
import { dateTime, EmptyState, ErrorState, Loading, localISODate, money, PageHeading, Panel, StatusBadge, time } from '../shared'
import { NewAppointmentModal } from './NewAppointmentModal'

const statuses: Array<{ value: AppointmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: 'no_show', label: 'Não compareceu' },
]

const dayLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${value}T12:00:00`))

const bookingNotice: Record<NotificationStatus, string> = {
  pending: 'Agendamento criado. A confirmação está em processamento.',
  opted_out: 'Agendamento criado. Sem consentimento: nenhuma mensagem foi enviada.',
  simulated: 'Agendamento criado. WhatsApp em simulação: nenhuma mensagem foi enviada.',
  not_configured: 'Agendamento criado. WhatsApp indisponível: nenhuma mensagem foi enviada.',
  accepted: 'Agendamento criado. O WhatsApp aceitou a confirmação; entrega ainda não confirmada.',
  sent: 'Agendamento criado. O WhatsApp aceitou a confirmação; entrega ainda não confirmada.',
  delivered: 'Agendamento criado. Confirmação entregue pelo WhatsApp.',
  read: 'Agendamento criado. Confirmação lida no WhatsApp.',
  failed: 'Agendamento criado. Falha no envio pelo WhatsApp.',
}

const cancellationNotice: Record<NotificationStatus, string> = {
  pending: 'O aviso está em processamento.',
  opted_out: 'A cliente não autorizou avisos automáticos; nenhuma mensagem foi enviada.',
  simulated: 'O aviso foi simulado; nenhuma mensagem foi enviada.',
  not_configured: 'O WhatsApp não está configurado para este aviso; nenhuma mensagem foi enviada.',
  accepted: 'A Meta aceitou o aviso; a entrega ainda não foi confirmada.',
  sent: 'O aviso foi enviado; a entrega ainda não foi confirmada.',
  delivered: 'O aviso foi entregue pelo WhatsApp.',
  read: 'O aviso foi lido no WhatsApp.',
  failed: 'O envio do aviso falhou. Consulte o histórico de mensagens.',
}

export function AgendaPage() {
  const [date, setDate] = useState(localISODate)
  const [status, setStatus] = useState<AppointmentStatus | 'all'>('all')
  const [items, setItems] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [showNew, setShowNew] = useState(false)
  const [notice, setNotice] = useState('')
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api.appointments(date, date)
      .then(value => { if (live) setItems(value) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Erro ao carregar agenda.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [date, retry])

  useEffect(() => {
    let live = true
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      void api.appointments(date, date).then(value => { if (live) setItems(value) }).catch(() => {
        // Keep the last known schedule; the next refresh or manual retry can recover.
      })
    }
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [date])

  useEffect(() => {
    if (!cancelTarget) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cancelBusy) setCancelTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelTarget, cancelBusy])

  const filtered = useMemo(
    () => items.filter(item => status === 'all' || item.status === status)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [items, status],
  )

  const moveDay = (offset: number) => {
    const next = new Date(`${date}T12:00:00`)
    next.setDate(next.getDate() + offset)
    setDate(localISODate(next))
  }

  const updateStatus = async (id: string, nextStatus: AppointmentStatus) => {
    setUpdating(id)
    setActionError('')
    setNotice('')
    try {
      const updated = await api.updateAppointment(id, nextStatus)
      setItems(current => current.map(item => item.id === id ? updated : item))
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o atendimento.')
    } finally {
      setUpdating(null)
    }
  }

  const changeStatus = (item: Appointment, nextStatus: AppointmentStatus) => {
    if (nextStatus === 'cancelled') {
      setCancelTarget(item)
      setCancelReason('')
      setActionError('')
      return
    }
    void updateStatus(item.id, nextStatus)
  }

  const confirmCancellation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = cancelTarget
    if (!target) return
    if (!target.serviceId) {
      setCancelTarget(null)
      setActionError('Não foi possível identificar o serviço. Atualize a agenda e tente novamente.')
      setRetry(value => value + 1)
      return
    }
    setCancelBusy(true)
    setActionError('')
    try {
      const updated = await api.cancelOwnerAppointment(target.id, {
        expectedDate: target.startsAt.slice(0, 10),
        expectedTime: target.startsAt.slice(11, 16),
        expectedServiceId: target.serviceId,
      }, cancelReason)
      setItems(current => current.map(item => item.id === target.id ? updated : item))
      setNotice(`Agendamento de ${target.clientName} cancelado e horário liberado. ${cancellationNotice[updated.notificationStatus]}`)
      setCancelTarget(null)
      setCancelReason('')
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Não foi possível confirmar o cancelamento.'
      setActionError(`${detail} A agenda foi atualizada; confira a situação antes de tentar novamente.`)
      setCancelTarget(null)
      setRetry(value => value + 1)
    } finally {
      setCancelBusy(false)
    }
  }

  return <div className="page">
    <PageHeading eyebrow="ORGANIZAÇÃO" title="Sua agenda"
      description="Cada atendimento no seu tempo, com tudo sob controle."
      action={<button className="btn btn-primary" onClick={() => setShowNew(true)}>
        <Plus size={18}/> Novo agendamento
      </button>}/>
    {notice ? <div className="agenda-notice" role="status">
      <span>{notice}</span><Link to="/app/configuracoes">Ver histórico de mensagens</Link>
    </div> : null}
    <div className="agenda-toolbar">
      <div className="date-control">
        <button type="button" className="icon-button" onClick={() => moveDay(-1)} aria-label="Dia anterior"><ChevronLeft size={20}/></button>
        <label><CalendarDays size={18}/><input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Escolher data"/></label>
        <button type="button" className="icon-button" onClick={() => moveDay(1)} aria-label="Próximo dia"><ChevronRight size={20}/></button>
      </div>
      <button className="btn btn-secondary today-button" onClick={() => setDate(localISODate())}>Hoje</button>
    </div>
    <Panel className="agenda-panel">
      <div className="panel-heading agenda-panel-heading">
        <div><span className="eyebrow">{dayLabel(date)}</span><h2>{items.length} {items.length === 1 ? 'atendimento' : 'atendimentos'}</h2></div>
        <div className="filter-wrap"><Filter size={17}/><select value={status}
          onChange={event => setStatus(event.target.value as AppointmentStatus | 'all')}
          aria-label="Filtrar por situação">
          {statuses.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></div>
      </div>
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {loading ? <Loading label="Organizando sua agenda..."/> : error
        ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)}/>
        : filtered.length ? <div className="schedule-list">
          {filtered.map(item => {
            const canCancel = ['pending', 'confirmed'].includes(item.status) &&
              new Date(item.startsAt).getTime() > Date.now()
            return <article className="schedule-item" key={item.id}>
              <div className="schedule-time"><strong>{time(item.startsAt)}</strong><span className="schedule-rail"/></div>
              <div className="schedule-content">
                <div className="schedule-main"><div className="schedule-avatar"><UserRound size={20}/></div>
                  <div><h3>{item.clientName}</h3><p>{item.serviceName}</p><small><Clock3 size={14}/> {dateTime(item.startsAt)}{item.endsAt ? ` — ${time(item.endsAt)}` : ''}</small></div>
                </div>
                <div className="schedule-side"><strong>{money(item.price)}</strong><StatusBadge status={item.status}/></div>
                <div className="schedule-actions"><select
                  aria-label={`Alterar situação de ${item.clientName}`}
                  disabled={updating === item.id || cancelBusy}
                  value={item.status}
                  onChange={event => changeStatus(item, event.target.value as AppointmentStatus)}>
                  {statuses.filter(option => option.value !== 'all').map(option =>
                    <option key={option.value} value={option.value}
                      disabled={option.value === 'cancelled' && !canCancel && item.status !== 'cancelled'}>
                      {option.label}
                    </option>)}
                </select></div>
              </div>
            </article>
          })}
        </div> : <EmptyState title={status === 'all' ? 'Seu dia está livre' : 'Nenhum atendimento nesse filtro'}
          detail={status === 'all' ? 'Compartilhe seu link para receber novos agendamentos.' : 'Tente selecionar outra situação.'}/>}
    </Panel>
    {showNew ? <NewAppointmentModal initialDate={date} onClose={() => setShowNew(false)}
      onCreated={notificationStatus => {
        setShowNew(false)
        setNotice(notificationStatus ? bookingNotice[notificationStatus] : 'Agendamento criado. Consulte o histórico de mensagens.')
        setRetry(value => value + 1)
      }}/> : null}
    {cancelTarget ? <div className="modal-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !cancelBusy) setCancelTarget(null) }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-appointment-title">
        <div className="modal-head"><span className="modal-icon"><CalendarDays size={22}/></span>
          <button type="button" className="icon-button" onClick={() => setCancelTarget(null)}
            disabled={cancelBusy} aria-label="Fechar"><X size={21}/></button>
        </div>
        <h2 id="cancel-appointment-title">Cancelar agendamento?</h2>
        <p>Confira a cliente e o horário antes de liberar a vaga.</p>
        <form className="form-stack" onSubmit={event => void confirmCancellation(event)}>
          <div className="form-hint"><strong>{cancelTarget.clientName}</strong><br/>
            {cancelTarget.serviceName} · {dateTime(cancelTarget.startsAt)}
            {cancelTarget.clientPhone ? <> · {cancelTarget.clientPhone}</> : null}
          </div>
          <label>Motivo que será enviado à cliente (opcional)
            <textarea rows={3} maxLength={100} value={cancelReason}
              onChange={event => setCancelReason(event.target.value)}
              placeholder="Ex.: surgiu um compromisso imprevisto"/>
          </label>
          <p className="form-hint">O aviso com opções de horário será registrado. O envio automático depende do consentimento da cliente e da configuração do WhatsApp da profissional.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" disabled={cancelBusy}
              onClick={() => setCancelTarget(null)}>Manter agendamento</button>
            <button type="submit" className="btn btn-primary" disabled={cancelBusy}>
              {cancelBusy ? 'Cancelando...' : 'Confirmar cancelamento'}
            </button>
          </div>
        </form>
      </div>
    </div> : null}
  </div>
}
