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
const compactMoney = (value: number) => `R$ ${new Intl.NumberFormat('pt-BR', {
  notation: 'compact', maximumFractionDigits: 1,
}).format(value)}`

function PeriodComparison({ rows }: {
  rows: Array<{ label: string; comparison: Comparison; format?: (value: number) => string }>
}) {
  return <div className="analysis-period-compare">
    <div className="analysis-period-legend"><span>Período anterior</span><span>Período selecionado</span></div>
    {rows.map(({ label, comparison, format = quantity }) => {
      const maximum = Math.max(1, comparison.current, comparison.previous)
      return <div className="analysis-period-row" key={label}>
        <strong>{label}</strong>
        <div className="analysis-period-bar"><span className="previous" style={{ width: `${Math.max(0, comparison.previous / maximum * 100)}%` }} />
          <span>{format(comparison.previous)}</span></div>
        <div className="analysis-period-bar"><span className="current" style={{ width: `${Math.max(0, comparison.current / maximum * 100)}%` }} />
          <span>{format(comparison.current)}</span></div>
      </div>
    })}
  </div>
}

function GroupedBars({ rows, labels }: {
  rows: Array<{ key: string; label: string; first: number; second: number; detail?: string }>
  labels: [string, string]
}) {
  const maximum = Math.max(1, ...rows.map(row => row.first))
  return <div className="analysis-grouped-bars">
    <div className="analysis-period-legend"><span>{labels[0]}</span><span>{labels[1]}</span></div>
    {rows.map(row => <div className="analysis-grouped-row" key={row.key}>
      <div className="analysis-bar-copy"><strong>{row.label}</strong>{row.detail ? <span>{row.detail}</span> : null}</div>
      <div className="analysis-grouped-line"><span>{quantity(row.first)}</span><div className="analysis-bar-track"><i className="first" style={{ width: `${row.first / maximum * 100}%` }} /></div></div>
      <div className="analysis-grouped-line"><span>{quantity(row.second)}</span><div className="analysis-bar-track"><i className="second" style={{ width: `${row.second / maximum * 100}%` }} /></div></div>
    </div>)}
  </div>
}

function TrendChart({ data, keys, title }: {
  data: Analytics['series']; keys: Array<{ key: SeriesKey; label: string; tone: 'rose' | 'sage' | 'slate' }>
  title: string
}) {
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, data.length - 1))
  const selected = data[Math.min(selectedIndex, data.length - 1)]
  const maximum = Math.max(1, ...data.flatMap(day => keys.map(line => day[line.key] || 0)))
  const xAt = (index: number) => 88 + index / Math.max(1, data.length - 1) * 650
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
    <div className="analysis-chart-scroll"><svg viewBox="0 0 780 228" role="img" aria-label={title} preserveAspectRatio="xMinYMid meet">
      {[0, 1, 2, 3].map(step => <g key={step}>
        <line x1="88" x2="738" y1={184 - step * 48} y2={184 - step * 48} className="analysis-gridline" />
        <text x="82" y={188 - step * 48} textAnchor="end" className="analysis-axis-label">
          {keys.some(key => key.key !== 'completed') ? compactMoney(maximum * step / 3) : quantity(Math.round(maximum * step / 3))}
        </text>
      </g>)}
      <line x1={xAt(Math.min(selectedIndex, data.length - 1))} x2={xAt(Math.min(selectedIndex, data.length - 1))}
        y1="39" y2="184" className="analysis-selection-line" />
      {keys.flatMap(line => paths(line.key).map((path, index) => <path key={`${line.key}-${index}`}
        d={path} pathLength={1} className={`analysis-line ${line.tone}`} />))}
      {keys.filter(line => line.key === 'ticketAverage').flatMap(line => data.map((day, index) =>
        day[line.key] === null ? null : <circle key={`${line.key}-${day.date}`}
          cx={xAt(index)} cy={yAt(day[line.key]!)} r="3" className={`analysis-point ${line.tone}`}>
          <title>{fullDateText(day.date)}: {displayValue(line.key, day[line.key])}</title>
        </circle>))}
      {keys.map(line => selected[line.key] === null ? null : <circle key={`selected-${line.key}`}
        cx={xAt(Math.min(selectedIndex, data.length - 1))} cy={yAt(selected[line.key]!)} r="5"
        className={`analysis-selected-point ${line.tone}`} />)}
      {[0, Math.floor((data.length - 1) / 2), data.length - 1].map(index =>
        <text key={index} x={xAt(index)} y="215"
          textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
          className="analysis-axis-label">{dateText(data[index].date)}</text>)}
    </svg></div>
    <div className="analysis-legend">{keys.map(line => <span key={line.key} className={line.tone}>{line.label}</span>)}</div>
    <div className="analysis-chart-inspector">
      <label htmlFor={`analysis-date-${title.replace(/\W/g, '-')}`}>Explore os dias do gráfico</label>
      <input id={`analysis-date-${title.replace(/\W/g, '-')}`} type="range" min="0" max={data.length - 1}
        value={Math.min(selectedIndex, data.length - 1)} onChange={event => setSelectedIndex(Number(event.target.value))}
        aria-valuetext={fullDateText(selected.date)} />
      <div className="analysis-selected-values" aria-live="polite"><strong>{fullDateText(selected.date)}</strong>
        {keys.map(line => <span key={line.key}>{line.label}: <b>{displayValue(line.key, selected[line.key])}</b></span>)}
      </div>
    </div>
    <div className="analysis-chart-summary">{keys.map(line => {
      const valid = data.filter(day => day[line.key] !== null)
      const peak = valid.reduce<typeof valid[number] | null>((best, day) =>
        !best || day[line.key]! > best[line.key]! ? day : best, null)
      const total = line.key === 'ticketAverage' ? null : valid.reduce((sum, day) => sum + day[line.key]!, 0)
      return <div key={line.key}><strong>{line.label}</strong>
        <span>{total === null ? `${valid.length} dia(s) com atendimento` : `Total: ${displayValue(line.key, total)}`}</span>
        <small>{peak ? `Maior dia: ${fullDateText(peak.date)} (${displayValue(line.key, peak[line.key])})` : 'Sem valor no período'}</small>
      </div>
    })}</div>
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
    <section className="analysis-surface"><header><span>Comparação</span><h2>Período selecionado e período anterior</h2>
      <p>Valores totais e atendimentos dos dois intervalos de {data.period.days} dias. Cada indicador usa sua própria escala.</p></header>
      <PeriodComparison rows={[
        { label: 'Entradas registradas', comparison: data.overview.income, format: money },
        { label: 'Despesas registradas', comparison: data.overview.expenses, format: money },
        { label: 'Atendimentos concluídos', comparison: data.overview.completed },
        { label: 'Ticket médio', comparison: data.overview.ticketAverage, format: money },
      ]} />
    </section>
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
          { key: 'one', label: '1 atendimento', value: clients.frequency.one, detail: total ? percent(clients.frequency.one / total * 100) : undefined },
          { key: 'two', label: '2 atendimentos', value: clients.frequency.two, detail: total ? percent(clients.frequency.two / total * 100) : undefined },
          { key: 'three', label: '3 ou mais', value: clients.frequency.threePlus, detail: total ? percent(clients.frequency.threePlus / total * 100) : undefined },
        ]} />
        <DataExplanation>Contagem de atendimentos concluídos de cada cliente dentro do período selecionado.</DataExplanation>
      </section>
    </div>
    <section className="analysis-surface"><header><span>Fidelização</span><h2>Clientes do período anterior que voltaram</h2>
      <p>De {quantity(clients.retention.eligible)} cliente(s) atendida(s) no período anterior, {quantity(clients.retention.returned)} tiveram atendimento concluído também neste período.</p></header>
      {clients.retention.eligible ? <BarRows rows={[
        { key: 'returned', label: 'Voltaram', value: clients.retention.returned, detail: percent(clients.retention.rate) },
        { key: 'not-returned', label: 'Ainda não voltaram', value: clients.retention.eligible - clients.retention.returned },
      ]} /> : <p className="analysis-empty">Ainda não há clientes atendidas no período anterior para comparar.</p>}
      <DataExplanation>{data.definitions.retention}</DataExplanation>
    </section>
    <div className="analysis-grid two">
      <section className="analysis-surface"><header><span>Relacionamento</span><h2>Clientes que mais vieram</h2></header>
        {clients.top.length ? <BarRows rows={clients.top.map((client, index) => ({
          key: client.id, label: `${index + 1}. ${client.name}`, value: client.visits,
          detail: `${money(client.completedValue)} em preços de serviços`,
        }))} /> : <p className="analysis-empty">Sem atendimentos concluídos no período.</p>}
        <DataExplanation>Visitas e valores correspondem apenas aos atendimentos concluídos no período.</DataExplanation>
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
    <section className="analysis-surface"><header><span>Comparação</span><h2>Ticket e volume de atendimentos</h2>
      <p>O ticket usa preços dos agendamentos concluídos; cada linha tem escala própria.</p></header>
      <PeriodComparison rows={[
        { label: 'Ticket médio', comparison: data.overview.ticketAverage, format: money },
        { label: 'Atendimentos concluídos', comparison: data.overview.completed },
      ]} />
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
    <section className="analysis-surface"><header><span>Demanda e execução</span><h2>Reservas e atendimentos concluídos</h2>
      <p>Compare o volume por serviço. Reservas incluem todos os estados, inclusive cancelamentos e faltas.</p></header>
      {data.services.length ? <GroupedBars labels={['Reservas', 'Concluídos']} rows={data.services.map(service => ({
        key: service.id, label: service.name, first: service.bookings, second: service.completed,
        detail: service.bookings ? `${percent(service.completed / service.bookings * 100)} concluídos` : 'Sem reservas',
      }))} /> : <p className="analysis-empty">Sem serviços cadastrados ou agendados neste período.</p>}
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
    <section className="analysis-surface"><header><span>Comparação do caixa</span><h2>Entradas, despesas e saldo entre períodos</h2>
      <p>Cada linha usa escala própria; valores negativos de saldo aparecem no número, sem barra proporcional.</p></header>
      <PeriodComparison rows={[
        { label: 'Entradas', comparison: data.overview.income, format: money },
        { label: 'Despesas', comparison: data.overview.expenses, format: money },
        { label: 'Saldo registrado', comparison: data.overview.balance, format: money },
      ]} />
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
        <BarRows rows={labels.map(item => ({ ...item, key: item.key,
          detail: data.appointments.denominator ? percent(item.value / data.appointments.denominator * 100) : undefined,
        }))} />
        <DataExplanation>Percentuais calculados sobre todos os agendamentos com data no período.</DataExplanation>
      </section>
      <section className="analysis-surface"><header><span>Distribuição semanal</span><h2>Agendamentos por dia da semana</h2></header>
        <GroupedBars labels={['Agendamentos', 'Concluídos']} rows={[1, 2, 3, 4, 5, 6, 0].map(day => ({
          key: String(day), label: dayNames[day],
          first: data.appointments.weekday[day]?.bookings || 0,
          second: data.appointments.weekday[day]?.completed || 0,
          detail: `${data.appointments.weekday[day]?.cancelled || 0} cancelados · ${data.appointments.weekday[day]?.noShow || 0} faltas`,
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
