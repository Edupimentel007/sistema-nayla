import { Router } from 'express';
import { db, dateAgo, fromCents, localNow } from './db.js';

type Row = Record<string, any>;
export type AnalyticsPeriod = 7 | 30 | 60 | 90;
const validPeriods = new Set<number>([7, 30, 60, 90]);
const money = (cents: number) => fromCents(cents);
const rate = (part: number, total: number) => total > 0 ? Math.round(part / total * 1000) / 10 : null;
const rounded = (value: number) => Math.round(value * 10) / 10;
const currency = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(money(cents));

function offsetDate(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function change(current: number, previous: number) {
  return { current, previous, changePercent: previous > 0 ? rounded((current - previous) / previous * 100) : null };
}

function dateRange(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = offsetDate(date, 1)) dates.push(date);
  return dates;
}

export function analyticsFor(businessId: string, period: AnalyticsPeriod = 30) {
  const to = localNow().date;
  const from = dateAgo(period);
  const previousTo = offsetDate(from, -1);
  const previousFrom = offsetDate(from, -period);
  const finance = db.prepare(`SELECT date,type,SUM(amount_cents) AS cents
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?
    GROUP BY date,type`).all(businessId, previousFrom, to) as Row[];
  const bookings = db.prepare(`SELECT a.id,a.client_id,a.service_id,a.date,a.status,a.price_cents,
    u.name AS client_name,s.name AS service_name,s.category AS service_category
    FROM appointments a JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id
    JOIN services s ON s.id=a.service_id AND s.business_id=a.business_id
    WHERE a.business_id=? AND a.date BETWEEN ? AND ?`)
    .all(businessId, previousFrom, to) as Row[];
  const completedHistory = db.prepare(`SELECT a.client_id,a.date,a.price_cents,u.name
    FROM appointments a JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id
    WHERE a.business_id=? AND a.status='completed' AND a.date<=?
    ORDER BY a.date,a.start_time`).all(businessId, to) as Row[];
  const futureClients = new Set((db.prepare(`SELECT DISTINCT client_id FROM appointments
    WHERE business_id=? AND status IN ('pending','confirmed') AND date>=?`)
    .all(businessId, to) as Row[]).map(row => String(row.client_id)));
  const financeByDay = new Map<string, { income: number; expenses: number }>();
  for (const entry of finance) {
    const day = financeByDay.get(entry.date) || { income: 0, expenses: 0 };
    if (entry.type === 'income') day.income += entry.cents;
    else day.expenses += entry.cents;
    financeByDay.set(entry.date, day);
  }
  const currentBookings = bookings.filter(row => row.date >= from);
  const previousBookings = bookings.filter(row => row.date <= previousTo);
  const currentCompleted = currentBookings.filter(row => row.status === 'completed');
  const previousCompleted = previousBookings.filter(row => row.status === 'completed');
  const sum = (items: Row[]) => items.reduce((total, item) => total + Number(item.price_cents), 0);
  const currentValue = sum(currentCompleted);
  const previousValue = sum(previousCompleted);
  const ticketCents = currentCompleted.length ? Math.round(currentValue / currentCompleted.length) : 0;
  const previousTicketCents = previousCompleted.length ? Math.round(previousValue / previousCompleted.length) : 0;
  const moneyBetween = (start: string, end: string, kind: 'income' | 'expenses') =>
    [...financeByDay].filter(([day]) => day >= start && day <= end)
      .reduce((total, [, values]) => total + values[kind], 0);
  const income = moneyBetween(from, to, 'income');
  const expenses = moneyBetween(from, to, 'expenses');
  const previousIncome = moneyBetween(previousFrom, previousTo, 'income');
  const previousExpenses = moneyBetween(previousFrom, previousTo, 'expenses');

  const completedByClient = new Map<string, { name: string; dates: string[]; totalCents: number }>();
  for (const visit of completedHistory) {
    const record = completedByClient.get(visit.client_id) || { name: visit.name, dates: [] as string[], totalCents: 0 };
    record.dates.push(visit.date);
    record.totalCents += visit.price_cents;
    completedByClient.set(visit.client_id, record);
  }
  const currentClientIds = new Set(currentCompleted.map(row => String(row.client_id)));
  const previousClientIds = new Set(previousCompleted.map(row => String(row.client_id)));
  const retained = [...previousClientIds].filter(clientId => currentClientIds.has(clientId)).length;
  const newClients = [...currentClientIds].filter(clientId => {
    const firstVisit = completedByClient.get(clientId)?.dates[0];
    return Boolean(firstVisit && firstVisit >= from);
  }).length;
  const returningClients = currentClientIds.size - newClients;
  const frequency = { one: 0, two: 0, threePlus: 0 };
  const currentVisitsByClient = new Map<string, { name: string; visits: number; cents: number }>();
  for (const appointment of currentCompleted) {
    const item = currentVisitsByClient.get(appointment.client_id) ||
      { name: appointment.client_name, visits: 0, cents: 0 };
    item.visits += 1;
    item.cents += appointment.price_cents;
    currentVisitsByClient.set(appointment.client_id, item);
  }
  for (const client of currentVisitsByClient.values()) {
    if (client.visits === 1) frequency.one += 1;
    else if (client.visits === 2) frequency.two += 1;
    else frequency.threePlus += 1;
  }
  const inactive = [...completedByClient].flatMap(([id, client]) => {
    const lastVisit = client.dates.at(-1)!;
    const daysSince = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${lastVisit}T12:00:00Z`)) / 86_400_000);
    return daysSince >= 30 && !futureClients.has(id)
      ? [{ id, name: client.name, lastVisit, daysSince, visits: client.dates.length }] : [];
  }).sort((a, b) => b.daysSince - a.daysSince || a.name.localeCompare(b.name, 'pt-BR'));

  const serviceMap = new Map<string, {
    id: string; name: string; category: string; bookings: number;
    completed: number; cancelled: number; noShow: number; valueCents: number;
  }>();
  const activeServices = db.prepare(`SELECT id,name,category FROM services
    WHERE business_id=? AND active=1`).all(businessId) as Row[];
  for (const service of activeServices) serviceMap.set(service.id, {
    id: service.id, name: service.name, category: service.category,
    bookings: 0, completed: 0, cancelled: 0, noShow: 0, valueCents: 0,
  });
  for (const appointment of currentBookings) {
    const item = serviceMap.get(appointment.service_id) || {
      id: appointment.service_id, name: appointment.service_name,
      category: appointment.service_category, bookings: 0,
      completed: 0, cancelled: 0, noShow: 0, valueCents: 0,
    };
    item.bookings += 1;
    if (appointment.status === 'completed') {
      item.completed += 1;
      item.valueCents += appointment.price_cents;
    }
    if (appointment.status === 'cancelled') item.cancelled += 1;
    if (appointment.status === 'no_show') item.noShow += 1;
    serviceMap.set(item.id, item);
  }
  const services = [...serviceMap.values()].map(item => ({
    id: item.id, name: item.name, category: item.category,
    bookings: item.bookings, completed: item.completed,
    cancelled: item.cancelled, noShow: item.noShow,
    completedValue: money(item.valueCents),
    ticketAverage: item.completed ? money(Math.round(item.valueCents / item.completed)) : 0,
    valueSharePercent: rate(item.valueCents, currentValue) || 0,
  })).sort((a, b) => b.completedValue - a.completedValue || b.completed - a.completed);

  const statuses = {
    pending: currentBookings.filter(row => row.status === 'pending').length,
    confirmed: currentBookings.filter(row => row.status === 'confirmed').length,
    completed: currentCompleted.length,
    cancelled: currentBookings.filter(row => row.status === 'cancelled').length,
    noShow: currentBookings.filter(row => row.status === 'no_show').length,
  };
  const weekday = Array.from({ length: 7 }, (_, day) => ({
    day, bookings: 0, completed: 0, cancelled: 0, noShow: 0,
  }));
  for (const appointment of currentBookings) {
    const item = weekday[new Date(`${appointment.date}T12:00:00Z`).getUTCDay()];
    item.bookings += 1;
    if (appointment.status === 'completed') item.completed += 1;
    if (appointment.status === 'cancelled') item.cancelled += 1;
    if (appointment.status === 'no_show') item.noShow += 1;
  }
  const completedByDay = new Map<string, { count: number; cents: number }>();
  for (const appointment of currentCompleted) {
    const item = completedByDay.get(appointment.date) || { count: 0, cents: 0 };
    item.count += 1;
    item.cents += appointment.price_cents;
    completedByDay.set(appointment.date, item);
  }
  const bookingsByDay = new Map<string, number>();
  for (const appointment of currentBookings)
    bookingsByDay.set(appointment.date, (bookingsByDay.get(appointment.date) || 0) + 1);
  const series = dateRange(from, to).map(date => {
    const cash = financeByDay.get(date) || { income: 0, expenses: 0 };
    const visits = completedByDay.get(date);
    return {
      date, income: money(cash.income), expenses: money(cash.expenses),
      balance: money(cash.income - cash.expenses),
      bookings: bookingsByDay.get(date) || 0,
      completed: visits?.count || 0,
      ticketAverage: visits ? money(Math.round(visits.cents / visits.count)) : null,
    };
  });
  const topClients = [...currentVisitsByClient].map(([id, client]) => ({
    id, name: client.name, visits: client.visits, completedValue: money(client.cents),
  })).sort((a, b) => b.visits - a.visits || b.completedValue - a.completedValue).slice(0, 10);
  const cancellationRate = rate(statuses.cancelled, currentBookings.length);
  const noShowRate = rate(statuses.noShow, currentBookings.length);
  const retentionRate = rate(retained, previousClientIds.size);
  const highestDemand = [...services].sort((a, b) => b.bookings - a.bookings || b.completedValue - a.completedValue)[0];
  const busiestWeekday = [...weekday].sort((a, b) => b.bookings - a.bookings)[0];
  const weekdayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado'];
  const expenseShare = rate(expenses, income);
  const ticketChange = previousTicketCents > 0
    ? rounded((ticketCents - previousTicketCents) / previousTicketCents * 100) : null;
  const insights = [
    {
      category: 'finance', title: 'Leitura do caixa',
      explanation: income || expenses
        ? `Entradas: ${currency(income)}. Despesas: ${currency(expenses)}${income ? ` (${expenseShare}% das entradas)` : ''}. Saldo registrado: ${currency(income - expenses)}. Esses valores vêm do Financeiro, não do saldo bancário.`
        : 'Ainda não há entradas ou despesas registradas neste período. Sem lançamentos, não é possível avaliar a evolução do caixa.',
      tip: !income && !expenses
        ? 'Registre recebimentos e despesas no Financeiro, com a data correta, para formar uma base de comparação.'
        : expenses > income
          ? 'As despesas registradas superaram as entradas. Revise custos recorrentes e materiais antes de ajustar preços ou horários.'
          : expenseShare !== null && expenseShare >= 60
            ? 'As despesas consomem ao menos 60% das entradas. Separe materiais, aluguel e outros custos nas descrições para descobrir onde agir primeiro.'
            : 'Acompanhe a evolução semanal e registre despesas pequenas também; entradas sem custos completos podem superestimar o resultado.',
    },
    {
      category: 'ticket', title: 'Valor por atendimento',
      explanation: currentCompleted.length
        ? `${currency(currentValue)} em ${currentCompleted.length} atendimento(s) concluído(s): ticket médio de ${currency(ticketCents)}.${previousCompleted.length ? ` No período anterior, foi ${currency(previousTicketCents)}${ticketChange === null ? '; a variação percentual não é calculada quando a base anterior é zero.' : ` (${ticketChange >= 0 ? '+' : ''}${ticketChange}%).`}` : ' Ainda não há base de atendimentos no período anterior.'}`
        : 'Ainda não há atendimentos concluídos neste período; o ticket médio não pode ser avaliado.',
      tip: currentCompleted.length
        ? ticketChange !== null && ticketChange < -5
          ? 'O ticket caiu mais de 5% frente ao período anterior. Compare a participação dos serviços, seus preços e a duração antes de fazer ajustes.'
          : 'Compare o ticket por serviço e o tempo necessário em cada atendimento. Revise preços com base nos custos e na procura observada.'
        : 'Marque os atendimentos realizados como concluídos na Agenda para começar a acompanhar o ticket.',
    },
    {
      category: 'clients', title: 'Retorno de clientes',
      explanation: previousClientIds.size
        ? `${retained} de ${previousClientIds.size} cliente(s) com atendimento concluído no período anterior voltaram neste período (${retentionRate}%). Foram ${newClients} cliente(s) em primeira visita e ${returningClients} já atendida(s) antes.`
        : `Ainda não há clientes com atendimento concluído no período anterior para calcular retorno. Neste período, ${newClients} cliente(s) fizeram a primeira visita.`,
      tip: inactive.length
        ? `Há ${inactive.length} cliente(s) sem visita há pelo menos 30 dias e sem reserva futura. Consulte a lista de Clientes e planeje um contato individual, respeitando a preferência de comunicação.`
        : previousClientIds.size && retained === 0
          ? 'Nenhuma cliente do período anterior voltou neste intervalo. Revise a frequência típica dos serviços e convide quem estiver no momento adequado para retornar.'
          : 'Observe a frequência de cada cliente e acompanhe a taxa de retorno em mais de um período antes de mudar sua rotina de relacionamento.',
    },
    {
      category: 'services', title: 'Preferência por serviços',
      explanation: services[0]?.completed
        ? `${services[0].name} liderou o valor de atendimentos concluídos (${currency(Math.round(services[0].completedValue * 100))}, ${services[0].valueSharePercent}% do total). ${highestDemand?.name} teve o maior número de reservas (${highestDemand?.bookings}).`
        : 'Ainda não há serviços concluídos no período para comparar procura e valor.',
      tip: highestDemand?.bookings
        ? 'Compare reservas, conclusões, cancelamentos e ticket por serviço. Reforce os horários dos mais procurados e investigue perdas antes de divulgar um serviço.'
        : 'Divulgue seu link de agendamento e conclua os atendimentos realizados para começar a comparar a procura por serviço.',
    },
    {
      category: 'agenda', title: 'Cancelamentos e faltas',
      explanation: currentBookings.length
        ? `Houve ${statuses.cancelled} cancelamento(s) (${cancellationRate}%) e ${statuses.noShow} falta(s) (${noShowRate}%) em ${currentBookings.length} agendamento(s) com data no período.${busiestWeekday?.bookings ? ` ${weekdayNames[busiestWeekday.day]} teve mais reservas (${busiestWeekday.bookings}).` : ''}`
        : 'Não há agendamentos com data neste período.',
      tip: statuses.cancelled || statuses.noShow
        ? 'Confirme os horários com antecedência e observe em quais dias ocorrem as perdas. Uma remarcação solicitada pela profissional aparece como cancelamento até a cliente reservar novamente.'
        : 'Continue acompanhando cancelamentos e faltas; compare períodos com volume semelhante antes de atribuir uma mudança a um horário específico.',
    },
  ];
  return {
    period: { days: period, from, to, previousFrom, previousTo },
    overview: {
      income: change(money(income), money(previousIncome)),
      expenses: change(money(expenses), money(previousExpenses)),
      balance: change(money(income - expenses), money(previousIncome - previousExpenses)),
      ticketAverage: change(money(ticketCents), money(previousTicketCents)),
      completed: change(currentCompleted.length, previousCompleted.length),
      bookings: currentBookings.length, clientsServed: currentClientIds.size,
      cancellationRate, noShowRate,
    },
    clients: {
      new: newClients, returning: returningClients,
      retention: { eligible: previousClientIds.size, returned: retained, rate: retentionRate },
      averageVisits: currentClientIds.size ? rounded(currentCompleted.length / currentClientIds.size) : null,
      frequency, inactiveCount: inactive.length, inactive: inactive.slice(0, 20), top: topClients,
    },
    appointments: { statuses, cancellationRate, noShowRate, denominator: currentBookings.length, weekday },
    services, series, insights,
    definitions: {
      revenue: 'Entradas registradas no Financeiro, incluindo atendimentos concluídos e lançamentos manuais.',
      ticket: 'Soma do preço dos agendamentos concluídos dividida pelo número desses atendimentos. Não inclui entradas manuais.',
      retention: 'Clientes com atendimento concluído no período anterior que também tiveram um atendimento concluído no período atual.',
      rates: 'Cancelamentos e faltas divididos por todos os agendamentos com data no período, inclusive pendentes e confirmados.',
      newClients: 'Nova cliente significa primeiro atendimento concluído no histórico até hoje, não apenas cadastro recente.',
    },
  };
}

export type Analytics = ReturnType<typeof analyticsFor>;

export const analyticsRouter = Router();
analyticsRouter.get('/', (req, res) => {
  const rawPeriod = req.query.period === undefined ? 30 : Number(req.query.period);
  if (!validPeriods.has(rawPeriod))
    return res.status(400).json({ error: 'Escolha um período de 7, 30, 60 ou 90 dias.' });
  const businessId = (res.locals.user as { business_id?: string } | undefined)?.business_id;
  if (!businessId) return res.status(401).json({ error: 'Faça login para continuar.' });
  res.json(analyticsFor(businessId, rawPeriod as AnalyticsPeriod));
});
