import { useEffect, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, CalendarCheck2, CircleHelp, RefreshCw } from 'lucide-react'
import { getAnalytics, type Analytics, type AnalyticsPeriod, type Comparison } from '../../lib/analyticsApi'
import { ErrorState, Loading, money, PageHeading, PeriodPicker, shortDate } from '../shared'
import './analytics.css'
import './admin-motion.css'

type Tab = 'visao' | 'clientes' | 'ticket' | 'servicos' | 'financeiro' | 'agenda'
const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'visao', label: 'Visão geral' }, { key: 'clientes', label: 'Clientes' },
  { key: 'ticket', label: 'Ticket médio' }, { key: 'servicos', label: 'Serviços' },
  { key: 'financeiro', label: 'Financeiro' }, { key: 'agenda', label: 'Agenda' },
]
const percent = (value: number | null) => value === null ? 'Sem base' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const quantity = (value: number) => value.toLocaleString('pt-BR')
const dateText = (value: string) => shortDate(value)
const fullDateText = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
}).format(new Date(`${value}T12:00:00-03:00`))

function Delta({ value, inverse = false }: { value: Comparison; inverse?: boolean }) {
  if (value.changePercent === null) return <span className="analysis-delta neutral">Comparação percentual indisponível</span>
  const increased = value.changePercent >= 0
  const favorable = inverse ? !increased : increased
  return <span className={`analysis-delta ${favorable ? 'up' : 'down'}`}>
    {increased ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
    {Math.abs(value.changePercent).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. período anterior
  </span>
}

function Stat({ label, value, detail, compare, inverse }: {
  label: string; value: string; detail: string; compare?: Comparison; inverse?: boolean
}) {
  return <div className="analysis-stat">
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    {compare ? <Delta value={compare} inverse={inverse} /> : null}
  </div>
}

function Note({ title, explanation, tip }: { title: string; explanation: string; tip: string }) {
  return <aside className="analysis-note">
    <div className="analysis-note-heading"><CircleHelp size={17} /><strong>{title}</strong></div>
    <p>{explanation}</p><div><b>Para melhorar</b><span>{tip}</span></div>
  </aside>
}

function Insight({ data, category }: { data: Analytics; category: string }) {
  const insight = data.insights.find(item => item.category === category)
  return insight ? <Note {...insight} /> : null
}

function BarRows({ rows, format = quantity }: {
  rows: Array<{ key: string; label: string; value: number; detail?: string }>
  format?: (value: number) => string
}) {
  const maximum = Math.max(1, ...rows.map(row => row.value))
  return <div className="analysis-bars">
    {rows.map(row => <div className="analysis-bar-row" key={row.key}>
      <div className="analysis-bar-copy"><strong>{row.label}</strong><span>{format(row.value)}{row.detail ? ` · ${row.detail}` : ''}</span></div>
      <div className="analysis-bar-track" aria-label={`${row.label}: ${format(row.value)}`}>
        <span style={{ width: `${row.value ? Math.max(2, row.value / maximum * 100) : 0}%` }} />
      </div>
    </div>)}
  </div>
}

type SeriesKey = 'income' | 'expenses' | 'completed' | 'ticketAverage'
function TrendChart({ data, keys, title }: {
  data: Analytics['series']; keys: Array<{ key: SeriesKey; label: string; tone: 'rose' | 'sage' | 'slate' }>
  title: string
}) {
  const maximum = Math.max(1, ...data.flatMap(day => keys.map(line => day[line.key] || 0)))
  const xAt = (index: number) => 48 + index / Math.max(1, data.length - 1) * 690
  const yAt = (value: number) => 184 - value / maximum * 145
  const paths = (key: SeriesKey) => {
    const segments: string[] = []
    let segment = ''
    data.forEach((day, index) => {
      const value = day[key]
      if (value === null) {
        if (segment) segments.push(segment)
        segment = ''
      } else segment += `${segment ? ' L' : 'M'}${xAt(index)},${yAt(value)}`
    })
    if (segment) segments.push(segment)
    return segments
  }
  const displayValue = (key: SeriesKey, value: number | null) =>
    value === null ? '—' : key === 'completed' ? quantity(value) : money(value)
  if (!data.some(day => keys.some(line => (day[line.key] || 0) > 0)))
    return <div className="analysis-chart-empty">Ainda não há dados suficientes para desenhar este gráfico no período.</div>
  return <div className="analysis-chart-wrap">
    <svg viewBox="0 0 780 228" role="img" aria-label={title} preserveAspectRatio="none">
      {[0, 1, 2, 3].map(step => <g key={step}>
        <line x1="48" x2="738" y1={184 - step * 48} y2={184 - step * 48} className="analysis-gridline" />
        <text x="42" y={188 - step * 48} textAnchor="end" className="analysis-axis-label">
          {keys.some(key => key.key !== 'completed') ? money(maximum * step / 3).replace(',00', '') : Math.round(maximum * step / 3)}
        </text>
      </g>)}
      {keys.flatMap(line => paths(line.key).map((path, index) => <path key={`${line.key}-${index}`}
        d={path} pathLength={1} className={`analysis-line ${line.tone}`} />))}
      {keys.filter(line => line.key === 'ticketAverage').flatMap(line => data.map((day, index) =>
        day[line.key] === null ? null : <circle key={`${line.key}-${day.date}`}
          cx={xAt(index)} cy={yAt(day[line.key]!)} r="3" className={`analysis-point ${line.tone}`}>
          <title>{fullDateText(day.date)}: {displayValue(line.key, day[line.key])}</title>
        </circle>))}
      {[0, Math.floor((data.length - 1) / 2), data.length - 1].map(index =>
        <text key={index} x={48 + index / Math.max(1, data.length - 1) * 690} y="215"
          textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
          className="analysis-axis-label">{dateText(data[index].date)}</text>)}
    </svg>
    <div className="analysis-legend">{keys.map(line => <span key={line.key} className={line.tone}>{line.label}</span>)}</div>
    <details className="analysis-chart-details"><summary>Ver valores dia a dia</summary>
      <div className="analysis-table-wrap"><table className="analysis-table">
        <thead><tr><th scope="col">Data</th>{keys.map(line => <th scope="col" key={line.key}>{line.label}</th>)}</tr></thead>
        <tbody>{data.map(day => <tr key={day.date}><th scope="row">{fullDateText(day.date)}</th>
          {keys.map(line => <td key={line.key}>{displayValue(line.key, day[line.key])}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </div>
}

function DataExplanation({ children }: { children: React.ReactNode }) {
  return <p className="analysis-definition"><CircleHelp size={14} aria-hidden="true" />{children}</p>
}

function Overview({ data }: { data: Analytics }) {
  return <div className="analysis-tab-body">
    <div className="analysis-grid two">
      <section className="analysis-surface analysis-chart-panel"><header><span>Movimento diário</span><h2>Entradas e despesas</h2><p>Valores lançados no Financeiro de {dateText(data.period.from)} a {dateText(data.period.to)}.</p></header>
        <TrendChart data={data.series} title="Gráfico diário de entradas e despesas" keys={[
          { key: 'income', label: 'Entradas', tone: 'rose' }, { key: 'expenses', label: 'Despesas', tone: 'sage' },
        ]} />
      </section>
      <section className="analysis-surface analysis-chart-panel"><header><span>Atendimentos</span><h2>Serviços concluídos por dia</h2><p>Quantidade de atendimentos marcados como concluídos na Agenda.</p></header>
        <TrendChart data={data.series} title="Gráfico diário de atendimentos concluídos" keys={[{ key: 'completed', label: 'Concluídos', tone: 'slate' }]} />
      </section>
    </div>
    <div className="analysis-grid notes">{data.insights.map(item => <Note key={item.category} {...item} />)}</div>
  </div>
}

function Clients({ data }: { data: Analytics }) {
  const clients = data.clients
  const total = clients.new + clients.returning
  return <div className="analysis-tab-body">
    <div className="analysis-grid three">
      <Stat label="Clientes atendidas" value={quantity(total)} detail="Clientes únicas com atendimento concluído" />
      <Stat label="Retorno do período anterior" value={percent(clients.retention.rate)}
        detail={`${clients.retention.returned} de ${clients.retention.eligible} cliente(s) voltaram`} />
      <Stat label="Frequência média" value={clients.averageVisits?.toLocaleString('pt-BR') || '—'}
        detail="Atendimentos concluídos por cliente atendida" />
    </div>
    <div className="analysis-grid two">
      <section className="analysis-surface"><header><span>Composição da carteira</span><h2>Primeira visita e retorno</h2></header>
        <BarRows rows={[
          { key: 'new', label: 'Primeira visita concluída', value: clients.new },
          { key: 'returning', label: 'Já atendidas antes', value: clients.returning },
        ]} />
        <DataExplanation>{data.definitions.newClients}</DataExplanation>
      </section>
      <section className="analysis-surface"><header><span>Frequência</span><h2>Quantas vezes vieram</h2></header>
        <BarRows rows={[
          { key: 'one', label: '1 atendimento', value: clients.frequency.one },
          { key: 'two', label: '2 atendimentos', value: clients.frequency.two },
          { key: 'three', label: '3 ou mais', value: clients.frequency.threePlus },
        ]} />
        <DataExplanation>Contagem de atendimentos concluídos de cada cliente dentro do período selecionado.</DataExplanation>
      </section>
    </div>
    <div className="analysis-grid two">
      <section className="analysis-surface"><header><span>Relacionamento</span><h2>Clientes que mais vieram</h2></header>
        {clients.top.length ? <div className="analysis-ranked">{clients.top.map((client, index) => <div key={client.id}>
          <span>{String(index + 1).padStart(2, '0')}</span><strong>{client.name}</strong>
          <small>{client.visits} visita(s) · {money(client.completedValue)}</small>
        </div>)}</div> : <p className="analysis-empty">Sem atendimentos concluídos no período.</p>}
      </section>
      <section className="analysis-surface"><header><span>Oportunidades de retorno</span><h2>Sem visita há 30 dias</h2>
        <p>{clients.inactiveCount} cliente(s) no histórico inteiro, sem agendamento futuro ativo.</p></header>
        {clients.inactive.length ? <div className="analysis-ranked">{clients.inactive.map(client => <div key={client.id}>
          <strong>{client.name}</strong><small>Última visita: {dateText(client.lastVisit)} · há {client.daysSince} dias</small>
        </div>)}</div> : <p className="analysis-empty">Nenhuma cliente nessa condição.</p>}
        {clients.inactiveCount > clients.inactive.length ? <p className="analysis-list-note">Exibindo {clients.inactive.length} de {clients.inactiveCount} clientes com esse critério.</p> : null}
      </section>
    </div>
    <DataExplanation>{data.definitions.retention} Em períodos curtos, o resultado pode variar bastante com poucas clientes.</DataExplanation>
    <Insight data={data} category="clients" />
  </div>
}

function Ticket({ data }: { data: Analytics }) {
  const withVisits = data.services.filter(item => item.completed)
  return <div className="analysis-tab-body">
    <div className="analysis-grid three">
      <Stat label="Ticket médio" value={data.overview.completed.current ? money(data.overview.ticketAverage.current) : '—'}
        detail="Preço médio dos atendimentos concluídos" compare={data.overview.ticketAverage} />
      <Stat label="Atendimentos concluídos" value={quantity(data.overview.completed.current)}
        detail="Base do cálculo do ticket" compare={data.overview.completed} />
      <Stat label="Clientes atendidas" value={quantity(data.overview.clientsServed)}
        detail="Cada cliente é contada uma vez no período" />
    </div>
    <section className="analysis-surface"><header><span>Comparação de preços realizados</span><h2>Ticket por serviço</h2>
      <p>Quanto cada atendimento concluído representou em média, pelos preços salvos no agendamento.</p></header>
      {withVisits.length ? <BarRows rows={withVisits.map(service => ({
        key: service.id, label: service.name, value: service.ticketAverage,
        detail: `${service.completed} concluído(s)`,
      }))} format={money} /> : <p className="analysis-empty">Conclua atendimentos para comparar o ticket dos serviços.</p>}
      <DataExplanation>{data.definitions.ticket} O comparativo usa a mesma quantidade de dias imediatamente anterior.</DataExplanation>
    </section>
    <section className="analysis-surface analysis-chart-panel"><header><span>Evolução do ticket</span><h2>Ticket médio por dia</h2>
      <p>Cada ponto considera apenas os atendimentos concluídos naquele dia. Dias sem atendimento ficam sem ponto.</p></header>
      <TrendChart data={data.series} title="Gráfico diário do ticket médio dos atendimentos concluídos"
        keys={[{ key: 'ticketAverage', label: 'Ticket médio', tone: 'rose' }]} />
    </section>
    <Insight data={data} category="ticket" />
  </div>
}

function Services({ data }: { data: Analytics }) {
  return <div className="analysis-tab-body">
    <section className="analysis-surface"><header><span>Portfólio</span><h2>Valor gerado por serviço</h2>
      <p>Preço somado dos atendimentos concluídos; pode diferir das entradas de caixa por incluir apenas agendamentos.</p></header>
      {data.services.length ? <BarRows rows={data.services.map(service => ({
        key: service.id, label: service.name, value: service.completedValue,
        detail: `${service.completed} concluído(s) · ${percent(service.valueSharePercent)} do valor`,
      }))} format={money} /> : <p className="analysis-empty">Nenhum serviço foi agendado no período.</p>}
      <DataExplanation>Serviços ativos sem reserva aparecem com zero. Serviços desativados continuam visíveis quando tiveram agendamento neste período.</DataExplanation>
    </section>
    <section className="analysis-surface"><header><span>Detalhamento</span><h2>Atividade de cada serviço</h2>
      <p>Veja demanda, execução, ticket e perdas de agenda lado a lado.</p></header>
      {data.services.length ? <div className="analysis-table-wrap"><table className="analysis-table">
        <thead><tr><th scope="col">Serviço</th><th scope="col">Agendados</th><th scope="col">Concluídos</th>
          <th scope="col">Ticket médio</th><th scope="col">Cancelados</th><th scope="col">Faltas</th></tr></thead>
        <tbody>{data.services.map(service => <tr key={service.id}><th scope="row">{service.name}<small>{service.category}</small></th>
          <td>{service.bookings}</td><td>{service.completed}</td>
          <td>{service.completed ? money(service.ticketAverage) : '—'}</td>
          <td>{service.cancelled}</td><td>{service.noShow}</td></tr>)}</tbody>
      </table></div> : <p className="analysis-empty">Sem serviços agendados no período.</p>}
    </section>
    <Insight data={data} category="services" />
  </div>
}

function Financial({ data }: { data: Analytics }) {
  return <div className="analysis-tab-body">
    <div className="analysis-grid three">
      <Stat label="Entradas" value={money(data.overview.income.current)} detail="Recebimentos registrados" compare={data.overview.income} />
      <Stat label="Despesas" value={money(data.overview.expenses.current)} detail="Saídas registradas" compare={data.overview.expenses} inverse />
      <Stat label="Saldo registrado" value={money(data.overview.balance.current)} detail="Entradas menos despesas" compare={data.overview.balance} />
    </div>
    <section className="analysis-surface analysis-chart-panel"><header><span>Evolução diária</span><h2>Entradas e despesas</h2>
      <p>Os dias sem lançamento aparecem com zero para manter o intervalo completo.</p></header>
      <TrendChart data={data.series} title="Gráfico de entradas e despesas diárias" keys={[
        { key: 'income', label: 'Entradas', tone: 'rose' }, { key: 'expenses', label: 'Despesas', tone: 'sage' },
      ]} />
      <DataExplanation>{data.definitions.revenue} O saldo mostra somente os registros feitos no app, não o saldo bancário.</DataExplanation>
    </section>
    <Insight data={data} category="finance" />
  </div>
}

function Agenda({ data }: { data: Analytics }) {
  const status = data.appointments.statuses
  const labels = [
    { key: 'completed', label: 'Concluídos', value: status.completed },
    { key: 'confirmed', label: 'Confirmados', value: status.confirmed },
    { key: 'pending', label: 'Pendentes', value: status.pending },
    { key: 'cancelled', label: 'Cancelados', value: status.cancelled },
    { key: 'noShow', label: 'Faltas', value: status.noShow },
  ]
  const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  return <div className="analysis-tab-body">
    <div className="analysis-grid three">
      <Stat label="Agendamentos" value={quantity(data.appointments.denominator)} detail="Com data no período selecionado" />
      <Stat label="Taxa de cancelamento" value={percent(data.appointments.cancellationRate)}
        detail={`${status.cancelled} de ${data.appointments.denominator} agendamento(s)`} />
      <Stat label="Taxa de falta" value={percent(data.appointments.noShowRate)}
        detail={`${status.noShow} de ${data.appointments.denominator} agendamento(s)`} />
    </div>
    <div className="analysis-grid two">
      <section className="analysis-surface"><header><span>Estado da agenda</span><h2>Resultado dos agendamentos</h2></header>
        <BarRows rows={labels.map(item => ({ ...item, key: item.key }))} />
      </section>
      <section className="analysis-surface"><header><span>Distribuição semanal</span><h2>Agendamentos por dia da semana</h2></header>
        <BarRows rows={[1, 2, 3, 4, 5, 6, 0].map(day => ({
          key: String(day), label: dayNames[day],
          value: data.appointments.weekday[day]?.bookings || 0,
          detail: `${data.appointments.weekday[day]?.completed || 0} concluído(s)`,
        }))} />
      </section>
    </div>
    <DataExplanation>{data.definitions.rates} Remarcações pedidas pela profissional podem registrar o horário original como cancelado.</DataExplanation>
    <Insight data={data} category="agenda" />
  </div>
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>(30)
  const [tab, setTab] = useState<Tab>('visao')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    getAnalytics(period).then(result => { if (live) setData(result) })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Erro ao carregar análises.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [period, retry])
  return <div className="page analysis-page">
    <PageHeading eyebrow="INTELIGÊNCIA DO NEGÓCIO" title="Análises" description="Entenda suas clientes, serviços, agenda e finanças com os registros do seu espaço."
      action={<PeriodPicker value={period} onChange={value => setPeriod(value as AnalyticsPeriod)} />} />
    <div className="analysis-intro">
      <div><Activity size={18} /><span>Dados reais do seu negócio</span></div>
      <p>{data ? `De ${fullDateText(data.period.from)} a ${fullDateText(data.period.to)} · comparação com os ${period} dias anteriores` : 'Selecione um período para explorar os indicadores.'}</p>
      <button type="button" onClick={() => setRetry(value => value + 1)} aria-label="Atualizar análises"><RefreshCw size={16} /> Atualizar</button>
    </div>
    {loading ? <Loading label="Preparando suas análises..." /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : data ? <>
      <div className="analysis-lead-stats">
        <Stat label="Entradas registradas" value={money(data.overview.income.current)} detail="Movimentações do Financeiro" compare={data.overview.income} />
        <Stat label="Ticket médio" value={data.overview.completed.current ? money(data.overview.ticketAverage.current) : '—'}
          detail="Por atendimento concluído" compare={data.overview.ticketAverage} />
        <Stat label="Clientes atendidas" value={quantity(data.overview.clientsServed)} detail="Com atendimento concluído" />
        <Stat label="Atendimentos concluídos" value={quantity(data.overview.completed.current)} detail="Base de serviços realizados" compare={data.overview.completed} />
      </div>
      <nav className="analysis-tabs" aria-label="Assuntos de análise">{tabs.map(item =>
        <button type="button" key={item.key} className={tab === item.key ? 'active' : ''} aria-current={tab === item.key ? 'page' : undefined}
          onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
      {tab === 'visao' ? <Overview data={data} /> : tab === 'clientes' ? <Clients data={data} /> :
        tab === 'ticket' ? <Ticket data={data} /> : tab === 'servicos' ? <Services data={data} /> :
        tab === 'financeiro' ? <Financial data={data} /> : <Agenda data={data} />}
      <footer className="analysis-footer">
        <CalendarCheck2 size={17} /><span>Os gráficos consideram registros com data até hoje em São Paulo. Conclua atendimentos e mantenha o Financeiro atualizado para interpretar as tendências.</span>
      </footer>
    </> : null}
  </div>
}
