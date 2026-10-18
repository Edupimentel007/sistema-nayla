import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Plus, Trash2, Wallet, X } from 'lucide-react'
import { api, type Appointment, type Finance, type FinancialEntry } from '../../lib/api'
import { EmptyState, ErrorState, Loading, money, PageHeading, Panel, PeriodPicker, shortDate } from '../shared'
import './admin-motion.css'
import './finance.css'

type FinanceFilter = { kind: 'past'; days: number } | { kind: 'upcoming' } | { kind: 'date'; value: string }

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function isInPeriod(date: string, period: number) {
  const today = todayInSaoPaulo()
  return date >= shiftDate(today, -period + 1) && date <= today
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isInFilter(date: string, filter: FinanceFilter) {
  if (filter.kind === 'past') return isInPeriod(date, filter.days)
  if (filter.kind === 'date') return date === filter.value
  const today = todayInSaoPaulo()
  return date > today && date <= shiftDate(today, 30)
}

function parseAmount(text: string) {
  const value = text.trim().replace(/\s/g, '')
  const normalized = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)
    ? value.replace(/\./g, '').replace(',', '.')
    : /^\d+(?:[,.]\d{1,2})?$/.test(value) ? value.replace(',', '.') : ''
  return normalized ? Number(normalized) : Number.NaN
}

function withEntry(finance: Finance, entry: FinancialEntry, direction: 1 | -1): Finance {
  const cents = Math.round(entry.amount * 100) * direction
  const incomeCents = Math.round(finance.income * 100) + (entry.type === 'income' ? cents : 0)
  const expensesCents = Math.round(finance.expenses * 100) + (entry.type === 'expense' ? cents : 0)
  const entries = direction === 1
    ? [entry, ...finance.entries].sort((a, b) => b.date.localeCompare(a.date) ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 1000)
    : finance.entries.filter(item => item.id !== entry.id)
  return { entries, income: incomeCents / 100, expenses: expensesCents / 100,
    balance: (incomeCents - expensesCents) / 100 }
}

export function FinancePage() {
  const [filter, setFilter] = useState<FinanceFilter>({ kind: 'past', days: 30 })
  const [data, setData] = useState<Finance | null>(null)
  const [dataFilterKey, setDataFilterKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [type, setType] = useState<'income' | 'expense'>('income')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInSaoPaulo)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [appointmentsLoading, setAppointmentsLoading] = useState(false)
  const [appointmentsError, setAppointmentsError] = useState('')
  const [appointmentsRetry, setAppointmentsRetry] = useState(0)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const filterKey = filter.kind === 'past' ? `past:${filter.days}` :
    filter.kind === 'date' ? `date:${filter.value}` : `upcoming:${todayInSaoPaulo()}`
  const visibleData = dataFilterKey === filterKey ? data : null
  const filterLabel = filter.kind === 'past' ? filter.days === 1 ? 'Hoje' : `Últimos ${filter.days} dias` :
    filter.kind === 'upcoming' ? 'Próximos 30 dias' : `Dia ${shortDate(filter.value)}`
  const futureDate = date > todayInSaoPaulo()
  const canLinkPayment = type === 'income' && !futureDate

  const openNewEntry = () => {
    setActionError('')
    setNotice('')
    setDate(todayInSaoPaulo())
    setSelectedAppointmentId('')
    setAppointments([])
    setAppointmentsError('')
    setAppointmentsLoading(true)
    setModalOpen(true)
  }

  useEffect(() => {
    let live = true
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    const request = filter.kind === 'past' ? api.finance(filter.days) :
      filter.kind === 'date' ? api.financeRange(filter.value, filter.value) :
        api.financeRange(shiftDate(todayInSaoPaulo(), 1), shiftDate(todayInSaoPaulo(), 30))
    request
      .then(value => { if (live && requestVersion.current === version) { setData(value); setDataFilterKey(filterKey) } })
      .catch(reason => { if (live && requestVersion.current === version) setError(reason instanceof Error ? reason.message : 'Erro ao carregar financeiro.') })
      .finally(() => { if (live && requestVersion.current === version) setLoading(false) })
    return () => { live = false }
  }, [filterKey, retry])

  useEffect(() => {
    if (!modalOpen) return
    let live = true
    const today = todayInSaoPaulo()
    setAppointmentsLoading(true)
    setAppointmentsError('')
    api.appointments(today, shiftDate(today, 90))
      .then(items => {
        if (live) {
          const eligible = items
            .filter(item => (item.status === 'pending' || item.status === 'confirmed') && item.price > 0)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          setAppointments(eligible)
          setSelectedAppointmentId(current => eligible.some(item => item.id === current) ? current : '')
        }
      })
      .catch(reason => {
        if (live) setAppointmentsError(reason instanceof Error ? reason.message : 'Não foi possível carregar os agendamentos.')
      })
      .finally(() => { if (live) setAppointmentsLoading(false) })
    return () => { live = false }
  }, [modalOpen, appointmentsRetry])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const value = parseAmount(amount)
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      setActionError('Informe um valor entre R$ 0,01 e R$ 1.000.000,00.')
      return
    }
    setSaving(true)
    setActionError('')
    try {
      const entry = await api.createFinancialEntry({ type, description: description.trim(), amount: value, date,
        ...(canLinkPayment && selectedAppointmentId ? { appointmentId: selectedAppointmentId } : {}) })
      const inPeriod = isInFilter(entry.date, filter)
      requestVersion.current += 1
      if (inPeriod && visibleData) setData(current => current ? withEntry(current, entry, 1) : current)
      const linkedNote = entry.prepaidAppointmentId
        ? ' Pagamento vinculado ao agendamento; apenas o valor restante será lançado na conclusão.' : ''
      setNotice((inPeriod
        ? `${entry.type === 'income' ? 'Entrada' : 'Despesa'} de ${money(entry.amount)} registrada. Os totais foram atualizados.`
        : `Lançamento salvo. Exibindo os totais e movimentações de ${shortDate(entry.date)}.`) + linkedNote)
      if (!inPeriod) setFilter({ kind: 'date', value: entry.date })
      setModalOpen(false)
      setDescription('')
      setAmount('')
      setDate(todayInSaoPaulo())
      setSelectedAppointmentId('')
      setRetry(current => current + 1)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível salvar lançamento.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry: FinancialEntry) => {
    if (!window.confirm(`Excluir o lançamento “${entry.description}”?`)) return
    setRemoving(entry.id)
    setActionError('')
    setNotice('')
    try {
      await api.deleteFinancialEntry(entry.id)
      requestVersion.current += 1
      if (visibleData) setData(current => current ? withEntry(current, entry, -1) : current)
      setNotice('Lançamento excluído. Os totais foram atualizados.')
      setRetry(current => current + 1)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível excluir lançamento.')
    } finally {
      setRemoving(null)
    }
  }

  return <div className="page">
    <PageHeading eyebrow="CONTROLE FINANCEIRO" title="Seu financeiro"
      description="Entradas manuais entram na data do recebimento. Atendimentos concluídos entram no faturamento; agendamentos futuros ainda não são receita."
      action={<div className="finance-period-actions">
        <PeriodPicker value={filter.kind === 'past' ? filter.days : 0} showToday
          onChange={days => { setFilter({ kind: 'past', days }); setNotice('') }} />
        <button type="button" className={`finance-filter-button ${filter.kind === 'upcoming' ? 'selected' : ''}`}
          aria-pressed={filter.kind === 'upcoming'} onClick={() => { setFilter({ kind: 'upcoming' }); setNotice('') }}>Próximos 30 dias</button>
        {filter.kind === 'date' ? <span className="finance-filter-date">Dia {shortDate(filter.value)}</span> : null}
      </div>} />
    <div className="finance-toolbar">
      <span>Visão: {filterLabel}{loading && visibleData ? ' · Atualizando...' : ''}</span>
      <button className="btn btn-primary" onClick={openNewEntry}>
        <Plus size={18}/> Novo lançamento
      </button>
    </div>
    {actionError && !modalOpen ? <p className="form-error" role="alert">{actionError}</p> : null}
    {notice && !modalOpen ? <p className="form-success" role="status">{notice}</p> : null}
    {loading && !visibleData ? <Loading label="Organizando suas finanças..." /> :
      error && !visibleData ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> :
      visibleData ? <>
        {error ? <p className="form-error" role="alert">Não foi possível atualizar agora. Exibindo os últimos dados carregados.</p> : null}
        <div className="metric-grid finance-metrics">
          <Panel className="metric"><div className="metric-icon mint"><ArrowDownLeft size={22}/></div><span className="metric-label">Entradas</span><strong>{money(visibleData.income)}</strong><small>Receitas no período</small></Panel>
          <Panel className="metric"><div className="metric-icon peach"><ArrowUpRight size={22}/></div><span className="metric-label">Saídas</span><strong>{money(visibleData.expenses)}</strong><small>Despesas no período</small></Panel>
          <Panel className="metric"><div className="metric-icon pink"><Wallet size={22}/></div><span className="metric-label">Saldo</span><strong>{money(visibleData.balance)}</strong><small>Entradas menos saídas</small></Panel>
        </div>
        <Panel>
          <div className="panel-heading"><div><span className="eyebrow">MOVIMENTAÇÕES</span><h2>Histórico financeiro</h2></div><span className="count-pill">{visibleData.entries.length} lançamentos</span></div>
          {visibleData.entries.length ? <div className="finance-list">{visibleData.entries.map(entry =>
            <div className="finance-row" key={entry.id}>
              <span className={`finance-type-icon ${entry.type}`}>
                {entry.type === 'income' ? <ArrowDownLeft size={19}/> : <ArrowUpRight size={19}/>}
              </span>
              <div className="finance-entry"><strong>{entry.description}</strong><small>{shortDate(entry.date)} · {entry.appointmentId ? 'Atendimento' : entry.prepaidAppointmentId ? 'Pagamento vinculado' : 'Lançamento manual'}</small></div>
              <strong className={entry.type === 'income' ? 'income-text' : 'expense-text'}>{entry.type === 'income' ? '+' : '-'} {money(entry.amount)}</strong>
              {!entry.appointmentId && entry.prepaidAppointmentStatus !== 'completed' ? <button className="icon-button delete-entry" title="Excluir lançamento"
                aria-label={`Excluir ${entry.description}`} disabled={removing === entry.id} onClick={() => void remove(entry)}>
                <Trash2 size={17}/>
              </button> : <span className="delete-placeholder"/>}
            </div>)}</div> : <EmptyState title="Nenhuma movimentação neste período"
            detail="Registre uma entrada ou despesa para acompanhar seu resultado."
            action={<button className="btn btn-secondary" onClick={openNewEntry}>Adicionar lançamento</button>} />}
        </Panel>
      </> : null}
    {modalOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setModalOpen(false) }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="finance-title">
        <div className="modal-head"><span className="modal-icon"><CircleDollarSign size={22}/></span><button className="icon-button" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Fechar"><X size={21}/></button></div>
        <h2 id="finance-title">Novo lançamento</h2><p>Registre uma movimentação do seu negócio.</p>
        <form className="form-stack" onSubmit={submit}>
          <div className="segmented" role="group" aria-label="Tipo de lançamento">
            <button type="button" className={type === 'income' ? 'selected' : ''} aria-pressed={type === 'income'} onClick={() => setType('income')}>Entrada</button>
            <button type="button" className={type === 'expense' ? 'selected' : ''} aria-pressed={type === 'expense'} onClick={() => { setType('expense'); setSelectedAppointmentId('') }}>Despesa</button>
          </div>
          <label>Descrição<input value={description} onChange={e => setDescription(e.target.value)}
            placeholder={type === 'income' ? 'Ex.: Venda de produto' : 'Ex.: Materiais de trabalho'} maxLength={100} required /></label>
          <div className="form-row">
            <label>Valor (R$)<input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0,00" required /></label>
            <label>{type === 'income' ? 'Data do recebimento' : 'Data do pagamento'}
              <input type="date" value={date} onChange={e => { setDate(e.target.value); if (e.target.value > todayInSaoPaulo()) setSelectedAppointmentId('') }} required /></label>
          </div>
          {type === 'income' ? <p className="finance-date-help">Se a cliente pagou hoje por um atendimento futuro, mantenha a data de hoje. Você pode vincular o agendamento quando a data do recebimento não for futura.</p>
            : <p className="finance-date-help">Informe a data em que a despesa foi paga.</p>}
          {futureDate ? <p className="finance-future-help" role="status">
            Esta data é futura. O valor ficará nos totais dessa data, não nos totais de hoje.
            <button type="button" onClick={() => setDate(todayInSaoPaulo())}>Recebi hoje</button>
          </p> : null}
          {canLinkPayment ? <div className="finance-appointment-field">
            <label>Vincular a um agendamento (opcional)
              <select value={selectedAppointmentId} onChange={event => setSelectedAppointmentId(event.target.value)}
                disabled={appointmentsLoading || Boolean(appointmentsError) || appointments.length === 0}
                aria-describedby="finance-appointment-help">
                <option value="">Sem vínculo com agendamento</option>
                {appointments.map(item => <option key={item.id} value={item.id}>
                  {shortDate(item.startsAt.slice(0, 10))} às {item.startsAt.slice(11, 16)} · {item.clientName} · {item.serviceName} · {money(item.price)}
                </option>)}
              </select>
            </label>
            <p id="finance-appointment-help" className="finance-date-help">Vincule pagamentos antecipados, inclusive sinais, para evitar receita duplicada. Ao concluir o atendimento, somente o valor restante entrará no financeiro.</p>
            {appointmentsLoading ? <p className="finance-date-help" role="status">Buscando agendamentos dos próximos 90 dias...</p> : null}
            {appointmentsError ? <p className="finance-appointment-error" role="alert">{appointmentsError} <button type="button" onClick={() => setAppointmentsRetry(value => value + 1)}>Tentar novamente</button></p> : null}
            {!appointmentsLoading && !appointmentsError && !appointments.length ? <p className="finance-date-help">Nenhum agendamento pendente ou confirmado disponível para vincular. Você ainda pode salvar a entrada sem vínculo.</p> : null}
          </div> : null}
          {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
          <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setModalOpen(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar lançamento'}</button></div>
        </form>
      </div>
    </div> : null}
  </div>
}
