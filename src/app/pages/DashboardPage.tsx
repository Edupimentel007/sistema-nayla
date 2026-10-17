import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, Check, ChevronRight, CircleDollarSign, Copy, Heart, RefreshCw, Sparkles, TrendingUp, UsersRound, Wallet } from 'lucide-react'
import { api, type Appointment, type Dashboard } from '../../lib/api'
import { publicBookingLink } from '../../lib/appOrigin'
import { useAuth } from '../contexts'
import { calendarDay, calendarMonth, dateTime, EmptyState, ErrorState, fullDate, Loading, money, PageHeading, Panel, PeriodPicker, StatusBadge, time } from '../shared'
import './admin-updates.css'
import './admin-motion.css'

type Today = { date: string; appointments: Appointment[] }

export function DashboardPage() {
  const { session } = useAuth()
  const [period, setPeriod] = useState(30)
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [today, setToday] = useState<Today | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState('')
  const [todayRetry, setTodayRetry] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => { let live = true; setLoading(true); setError(''); api.dashboard(period).then(value => { if (live) setData(value) }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Erro ao carregar dados.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [period, retry])
  useEffect(() => {
    let live = true
    const refresh = () => {
      api.appointmentsToday()
        .then(value => { if (live) { setToday(value); setTodayError('') } })
        .catch(reason => { if (live) setTodayError(reason instanceof Error ? reason.message : 'Erro ao carregar os atendimentos de hoje.') })
        .finally(() => { if (live) setTodayLoading(false) })
    }
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    const interval = window.setInterval(refreshWhenVisible, 30_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { live = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [todayRetry])
  const bookingLink = publicBookingLink(session?.business.slug ?? '')
  const copyLink = async () => { if (!bookingLink) return; try { await navigator.clipboard.writeText(bookingLink); setCopied(true); window.setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) } }
  const todayItems = [...(today?.appointments ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return <div className="page dashboard-page"><PageHeading eyebrow="PAINEL DO NEGÓCIO" title={`Bom te ver, ${session?.user.name.split(' ')[0]}!`} description="Acompanhe o que acontece no seu espaço, com tudo em um só lugar." action={<PeriodPicker value={period} onChange={setPeriod} />} />
    <div className="welcome-banner"><div><span className="welcome-icon"><Heart size={19} /></span><h2>Sua agenda está a um link de distância.</h2><p>Compartilhe sua página para suas clientes escolherem serviços e horários disponíveis.</p><button className="btn btn-white" onClick={copyLink} disabled={!bookingLink}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copiado!' : 'Copiar link de agendamento'}</button></div><div className="banner-illustration" aria-hidden="true"><div className="banner-circle one"/><div className="banner-circle two"/><CalendarDays size={82} strokeWidth={1.1}/></div></div>
    <TodayPanel today={today} items={todayItems} loading={todayLoading} error={todayError} onRetry={() => setTodayRetry(value => value + 1)} />
    {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : data ? <><div className="metric-grid"><Metric icon={<Wallet size={22}/>} label="Faturamento" value={money(data.revenue)} detail={`Nos últimos ${period} dias`} tone="pink" /><Metric icon={<TrendingUp size={22}/>} label="Ticket médio" value={money(data.ticketAverage)} detail="Por atendimento concluído" tone="peach" /><Metric icon={<CalendarDays size={22}/>} label="Atendimentos" value={String(data.appointments)} detail={`Nos últimos ${period} dias`} tone="lavender" /><Metric icon={<UsersRound size={22}/>} label="Clientes" value={String(data.clients)} detail="Com agendamentos no período" tone="mint" /></div><div className="dashboard-columns"><Panel><div className="panel-heading"><div><span className="eyebrow">AGENDA</span><h2>Atendimentos recentes</h2></div><Link className="subtle-link" to="/app/agenda">Ver agenda <ArrowRight size={16}/></Link></div>{data.recentAppointments?.length ? <div className="appointment-list">{data.recentAppointments.slice(0, 5).map(item => <div className="appointment-row" key={item.id}><div className="date-chip"><strong>{calendarDay(item.startsAt)}</strong><small>{calendarMonth(item.startsAt)}</small></div><div className="appointment-info"><strong>{item.clientName}</strong><span>{item.serviceName} · {dateTime(item.startsAt)}</span></div><StatusBadge status={item.status} /></div>)}</div> : <EmptyState title="Ainda não há atendimentos" detail="Quando suas clientes agendarem, os horários aparecerão aqui." />}</Panel><Panel><div className="panel-heading"><div><span className="eyebrow">RELACIONAMENTO</span><h2>Clientes que mais voltam</h2></div><Link className="subtle-link" to="/app/clientes">Ver clientes <ArrowRight size={16}/></Link></div>{data.topClients?.length ? <div className="top-clients">{data.topClients.slice(0, 5).map((client, index) => <div className="top-client" key={client.id}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="client-avatar">{client.name.charAt(0).toUpperCase()}</span><span className="client-details"><strong>{client.name}</strong><small>{client.visits} {client.visits === 1 ? 'visita' : 'visitas'}</small></span><strong className="client-spent">{money(client.spent)}</strong></div>)}</div> : <EmptyState title="Seu vínculo começa aqui" detail="As clientes mais frequentes aparecerão após os atendimentos." />}</Panel></div></> : null}
    <div className="dashboard-bottom"><div className="mini-help"><span><Sparkles size={19}/></span><div><strong>Precisa de uma informação rápida?</strong><p>Pergunte à Nayla sobre sua agenda, clientes ou faturamento.</p></div><Link to="/app/assistente" className="circle-link" aria-label="Abrir assistente Nayla"><ChevronRight size={20}/></Link></div><div className="mini-help"><span><CircleDollarSign size={19}/></span><div><strong>Tenha clareza sobre seus números</strong><p>Registre despesas e acompanhe o saldo do seu negócio.</p></div><Link to="/app/financeiro" className="circle-link" aria-label="Abrir financeiro"><ChevronRight size={20}/></Link></div></div>
  </div>
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <Panel className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></Panel>
}

function TodayPanel({ today, items, loading, error, onRetry }: { today: Today | null; items: Appointment[]; loading: boolean; error: string; onRetry: () => void }) {
  return <Panel className="today-panel">
    <div className="panel-heading"><div><span className="eyebrow">AGENDA DE HOJE</span><h2>Clientes do dia{today ? ` · ${items.length} agendamento${items.length === 1 ? '' : 's'}` : ''}</h2><p className="today-date">{today ? fullDate(today.date) : 'Atendimentos, serviços e horários de hoje'}</p></div><div className="today-panel-actions"><button className="icon-button" type="button" onClick={onRetry} aria-label="Atualizar clientes do dia" title="Atualizar clientes do dia"><RefreshCw size={18}/></button><Link className="subtle-link" to="/app/agenda">Ver agenda <ArrowRight size={16}/></Link></div></div>
    {error && today ? <p className="today-sync-error" role="status">Não foi possível atualizar agora. Mostrando a última lista carregada.</p> : null}
    {loading && !today ? <Loading label="Buscando clientes do dia..." /> : error && !today ? <ErrorState message={error} onRetry={onRetry} /> : items.length ? <div className="today-list">{items.map(item => <div className="today-row" key={item.id}><div className="today-time">{time(item.startsAt)}</div><div className="today-details"><strong>{item.clientName}</strong><span>{item.serviceName}{item.endsAt ? ` · até ${time(item.endsAt)}` : ''}</span></div><StatusBadge status={item.status}/></div>)}</div> : <EmptyState title="Nenhuma cliente agendada hoje" detail="Os novos agendamentos aparecerão aqui automaticamente." />}
  </Panel>
}
