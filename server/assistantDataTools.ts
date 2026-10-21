import { tool } from 'ai';
import { z } from 'zod';
import { db, dateAgo, fromCents, localNow, validDate } from './db.js';
import type { ExternalAssistantPrivacy } from './assistantPrivacy.js';

// Every query in this module is read-only and receives the authenticated owner's
// business ID from the server. The model never chooses a tenant or runs SQL.
type Row = Record<string, string | number | null>;
const periodSchema = z.enum([
  'today', 'tomorrow', 'last7', 'last30', 'last60', 'last90',
  'next7', 'next30', 'next90', 'next365', 'month', 'monthFull', 'previousMonth', 'custom',
]);
type Period = z.infer<typeof periodSchema>;
export type AssistantRangeRequest = { period?: Period; from?: string; to?: string };

const money = (cents: number) => fromCents(Number(cents || 0));
const offsetDate = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const endOfMonth = (iso: string) => offsetDate(`${iso.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR').trim();
// Client names and service labels are user supplied. Keep telephone and CPF-like
// strings out of model tool results even if someone stored them in a name field.
const safeLabel = (value: string) => value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail oculto]')
  .replace(/\b\+?\d[\d().\s-]{8,}\d\b/g, '[dado oculto]').slice(0, 180);

export function resolveAssistantRange(request: AssistantRangeRequest = {}) {
  const today = localNow().date;
  const period = request.period || 'last30';
  let from: string;
  let to: string;
  switch (period) {
    case 'today': from = to = today; break;
    case 'tomorrow': from = to = offsetDate(today, 1); break;
    case 'last7': from = dateAgo(7); to = today; break;
    case 'last30': from = dateAgo(30); to = today; break;
    case 'last60': from = dateAgo(60); to = today; break;
    case 'last90': from = dateAgo(90); to = today; break;
    case 'next7': from = today; to = offsetDate(today, 6); break;
    case 'next30': from = today; to = offsetDate(today, 29); break;
    case 'next90': from = today; to = offsetDate(today, 89); break;
    case 'next365': from = today; to = offsetDate(today, 364); break;
    case 'month': from = `${today.slice(0, 7)}-01`; to = today; break;
    case 'monthFull': from = `${today.slice(0, 7)}-01`; to = offsetDate(endOfMonth(today), -1); break;
    case 'previousMonth': {
      to = offsetDate(`${today.slice(0, 7)}-01`, -1);
      from = `${to.slice(0, 7)}-01`;
      break;
    }
    case 'custom': {
      if (!request.from || !request.to || !validDate(request.from) || !validDate(request.to))
        throw new RangeError('Para um período personalizado, informe datas válidas em AAAA-MM-DD.');
      from = request.from;
      to = request.to;
      break;
    }
  }
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 366) throw new RangeError('Consulte um intervalo de 1 a 366 dias.');
  return { period, from, to, days, timezone: 'America/Sao_Paulo' as const };
}

export function getAssistantFinance(businessId: string, request: AssistantRangeRequest = {}) {
  const range = resolveAssistantRange(request);
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS expenses,
    COUNT(CASE WHEN type='income' THEN 1 END) AS income_count,
    COUNT(CASE WHEN type='expense' THEN 1 END) AS expense_count
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?`)
    .get(businessId, range.from, range.to) as Row;
  const group = range.days <= 31 ? 'date' : "substr(date,1,7)";
  const series = db.prepare(`SELECT ${group} AS interval, type, SUM(amount_cents) AS cents
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?
    GROUP BY interval,type ORDER BY interval`).all(businessId, range.from, range.to) as Row[];
  const categories = db.prepare(`SELECT type,category,SUM(amount_cents) AS cents,COUNT(*) AS entries
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?
    GROUP BY type,category ORDER BY cents DESC LIMIT 30`)
    .all(businessId, range.from, range.to) as Row[];
  return {
    range, currency: 'BRL' as const,
    income: money(Number(totals.income)), expenses: money(Number(totals.expenses)),
    balance: money(Number(totals.income) - Number(totals.expenses)),
    incomeEntries: Number(totals.income_count), expenseEntries: Number(totals.expense_count),
    series: series.map(row => ({ interval: row.interval, type: row.type, amount: money(Number(row.cents)) })),
    categories: categories.map(row => ({ type: row.type,
      category: safeLabel(String(row.category || 'Sem categoria')),
      amount: money(Number(row.cents)), entries: Number(row.entries) })),
    definition: 'Entradas e despesas registradas no Financeiro, inclusive lançamentos manuais. incomeEntries e expenseEntries contam lançamentos, não atendimentos. Estes dados não vinculam entradas a clientes ou serviços. Saldo não é lucro líquido nem saldo bancário.',
  };
}

export type AssistantFinanceEntriesRequest = AssistantRangeRequest & {
  type?: 'all' | 'income' | 'expense';
  limit?: number;
};
export function getAssistantFinanceEntries(businessId: string, request: AssistantFinanceEntriesRequest = {}) {
  const range = resolveAssistantRange(request);
  const limit = Math.max(1, Math.min(30, Math.trunc(request.limit || 15)));
  const typeFilter = request.type && request.type !== 'all' ? 'AND type=?' : '';
  const params = request.type && request.type !== 'all'
    ? [businessId, range.from, range.to, request.type]
    : [businessId, range.from, range.to];
  const total = db.prepare(`SELECT COUNT(*) AS total FROM financial_entries
    WHERE business_id=? AND date BETWEEN ? AND ? ${typeFilter}`)
    .get(...params) as { total: number };
  const rows = db.prepare(`SELECT date,type,description,category,amount_cents
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ? ${typeFilter}
    ORDER BY date DESC,created_at DESC,id DESC LIMIT ?`)
    .all(...params, limit) as Row[];
  return { range, total: total.total, shown: rows.length,
    entries: rows.map(row => ({ date: row.date, type: row.type,
      description: safeLabel(String(row.description)), category: safeLabel(String(row.category || '')),
      amount: money(Number(row.amount_cents)) })),
    note: 'Descrições são dados escritos pela profissional e têm telefones, CPFs e e-mails ocultados. Os valores vêm dos lançamentos do Financeiro.',
  };
}

function clientMatches(businessId: string, query: string) {
  const normalized = normalizeName(query);
  if (normalized.length < 2 || normalized.length > 80)
    throw new RangeError('Informe pelo menos dois caracteres do nome da cliente.');
  const names = db.prepare(`SELECT id,name FROM users
    WHERE business_id=? AND role='client' ORDER BY name`).all(businessId) as { id: string; name: string }[];
  return names.filter(row => normalizeName(row.name).includes(normalized));
}

export type AssistantScheduleRequest = AssistantRangeRequest & {
  clientName?: string;
  status?: 'all' | 'scheduled' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  limit?: number;
};
export function getAssistantSchedule(businessId: string, request: AssistantScheduleRequest = {}) {
  const range = resolveAssistantRange({ period: request.period || 'today', from: request.from, to: request.to });
  const limit = Math.max(1, Math.min(40, Math.trunc(request.limit || 20)));
  const conditions = ['a.business_id=?', 'a.date BETWEEN ? AND ?'];
  const params: (string | number)[] = [businessId, range.from, range.to];
  if (request.clientName) {
    const matches = clientMatches(businessId, request.clientName);
    if (!matches.length) return { range, total: 0, appointments: [], matchedClientNames: [] };
    if (matches.length > 20)
      throw new RangeError(`${matches.length} clientes têm nome parecido. Informe mais partes do nome para consultar a agenda correta.`);
    conditions.push(`a.client_id IN (${matches.map(() => '?').join(',')})`);
    params.push(...matches.map(row => row.id));
  }
  const status = request.status || (request.period?.startsWith('next') ? 'scheduled' : 'all');
  if (status !== 'all') {
    if (status === 'scheduled') conditions.push("a.status IN ('pending','confirmed')");
    else { conditions.push('a.status=?'); params.push(status); }
  }
  if (request.period?.startsWith('next')) {
    conditions.push('(a.date>? OR (a.date=? AND a.start_time>=?))');
    params.push(localNow().date, localNow().date, localNow().time);
  }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS total FROM appointments a
    JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id AND u.role='client'
    JOIN services s ON s.id=a.service_id AND s.business_id=a.business_id
    WHERE ${where}`)
    .get(...params) as { total: number };
  const rows = db.prepare(`SELECT a.date,a.start_time,a.end_time,a.status,a.price_cents,
      u.name AS client_name,s.name AS service_name
    FROM appointments a
    JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id AND u.role='client'
    JOIN services s ON s.id=a.service_id AND s.business_id=a.business_id
    WHERE ${where} ORDER BY a.date,a.start_time,a.id LIMIT ?`)
    .all(...params, limit) as Row[];
  return {
    range, total: total.total,
    appointments: rows.map(row => ({ date: row.date, time: row.start_time, endTime: row.end_time,
      status: row.status, clientName: safeLabel(String(row.client_name)),
      serviceName: safeLabel(String(row.service_name)), servicePrice: money(Number(row.price_cents)) })),
    shown: rows.length,
  };
}

export function getAssistantClient(businessId: string, clientName: string) {
  const matches = clientMatches(businessId, clientName);
  const selected = matches.slice(0, 10);
  const clients = selected.map(client => {
    const stats = db.prepare(`SELECT COUNT(*) AS bookings,
      COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
      COUNT(CASE WHEN status='no_show' THEN 1 END) AS no_show,
      MAX(CASE WHEN status='completed' THEN date END) AS last_visit,
      MIN(CASE WHEN status IN ('pending','confirmed')
        AND (date>? OR (date=? AND start_time>=?)) THEN date END) AS next_booking,
      COALESCE(SUM(CASE WHEN status='completed' THEN price_cents ELSE 0 END),0) AS completed_value
      FROM appointments WHERE business_id=? AND client_id=?`)
      .get(localNow().date, localNow().date, localNow().time, businessId, client.id) as Row;
    return { name: safeLabel(client.name), bookings: Number(stats.bookings),
      completedVisits: Number(stats.completed), cancellations: Number(stats.cancelled),
      noShows: Number(stats.no_show), lastVisit: stats.last_visit, nextBookingDate: stats.next_booking,
      completedServiceValue: money(Number(stats.completed_value)) };
  });
  const history = matches.length === 1 ? db.prepare(`SELECT a.date,a.start_time,a.status,a.price_cents,
      s.name AS service_name
    FROM appointments a JOIN services s ON s.id=a.service_id AND s.business_id=a.business_id
    WHERE a.business_id=? AND a.client_id=? ORDER BY a.date DESC,a.start_time DESC LIMIT 12`)
    .all(businessId, matches[0].id) as Row[] : [];
  return {
    searchedName: safeLabel(clientName), totalMatches: matches.length, clients,
    appointments: history.map(row => ({ date: row.date, time: row.start_time, status: row.status,
      serviceName: safeLabel(String(row.service_name)), servicePrice: money(Number(row.price_cents)) })),
    definition: 'Valor de serviços concluídos não equivale necessariamente ao dinheiro recebido da cliente. CPF e telefone não são disponibilizados à assistente.',
  };
}

export type AssistantEventsRequest = AssistantRangeRequest & {
  actor?: 'all' | 'client' | 'owner';
  kind?: 'all' | 'cancelled' | 'rescheduled' | 'reschedule_requested';
  limit?: number;
};
export function getAssistantEvents(businessId: string, request: AssistantEventsRequest = {}) {
  const range = resolveAssistantRange(request);
  const limit = Math.max(1, Math.min(30, Math.trunc(request.limit || 20)));
  const conditions = ['e.business_id=?', 'a.business_id=e.business_id',
    "date(e.created_at,'-3 hours') BETWEEN ? AND ?"];
  const params: (string | number)[] = [businessId, range.from, range.to];
  if (request.actor && request.actor !== 'all') { conditions.push('e.actor=?'); params.push(request.actor); }
  if (request.kind && request.kind !== 'all') { conditions.push('e.kind=?'); params.push(request.kind); }
  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS total FROM appointment_events e
    JOIN appointments a ON a.id=e.appointment_id WHERE ${where}`)
    .get(...params) as { total: number };
  const rows = db.prepare(`SELECT e.actor,e.kind,e.previous_date,e.previous_time,
      e.new_date,e.new_time,e.created_at,u.name AS client_name,
      previous_service.name AS previous_service,current_service.name AS current_service
    FROM appointment_events e JOIN appointments a ON a.id=e.appointment_id
    JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id
    JOIN services current_service ON current_service.id=a.service_id AND current_service.business_id=a.business_id
    LEFT JOIN services previous_service ON previous_service.id=e.previous_service_id
      AND previous_service.business_id=a.business_id
    WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ?`)
    .all(...params, limit) as Row[];
  return { range, total: total.total, shown: rows.length,
    events: rows.map(row => ({ actor: row.actor, kind: row.kind,
      clientName: safeLabel(String(row.client_name)), previousDate: row.previous_date,
      previousTime: row.previous_time, newDate: row.new_date, newTime: row.new_time,
      previousService: row.previous_service ? safeLabel(String(row.previous_service)) : null,
      currentService: safeLabel(String(row.current_service)), createdAt: row.created_at })),
    note: 'Motivos livres não são enviados ao modelo para evitar divulgar dados sensíveis escritos em texto.' };
}

export function getAssistantServices(businessId: string, request: AssistantRangeRequest = {}) {
  const range = resolveAssistantRange(request);
  const totalServices = (db.prepare('SELECT COUNT(*) AS total FROM services WHERE business_id=?')
    .get(businessId) as { total: number }).total;
  const rows = db.prepare(`SELECT s.name,s.category,s.duration_minutes,s.price_cents,s.active,
      COUNT(a.id) AS bookings,
      COUNT(CASE WHEN a.status='completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN a.status='cancelled' THEN 1 END) AS cancelled,
      COUNT(CASE WHEN a.status='no_show' THEN 1 END) AS no_show,
      COALESCE(SUM(CASE WHEN a.status='completed' THEN a.price_cents ELSE 0 END),0) AS completed_value
    FROM services s LEFT JOIN appointments a ON a.service_id=s.id AND a.business_id=s.business_id
      AND a.date BETWEEN ? AND ?
    WHERE s.business_id=? GROUP BY s.id
    ORDER BY completed_value DESC,bookings DESC,s.name LIMIT 80`)
    .all(range.from, range.to, businessId) as Row[];
  return { range, currency: 'BRL' as const, totalServices, shown: rows.length,
    services: rows.map(row => ({ name: safeLabel(String(row.name)), category: row.category,
      active: Boolean(row.active), currentPrice: money(Number(row.price_cents)),
      durationMinutes: Number(row.duration_minutes), bookings: Number(row.bookings),
      completed: Number(row.completed), cancelled: Number(row.cancelled), noShows: Number(row.no_show),
      completedServiceValue: money(Number(row.completed_value)),
      averageCompletedServiceValue: Number(row.completed)
        ? money(Math.round(Number(row.completed_value) / Number(row.completed))) : null })),
    definition: 'Valor de serviços concluídos usa o preço do agendamento. Não é faturamento recebido nem lucro; preço atual pode ter mudado desde a reserva.',
  };
}

export function getAssistantInactiveClients(businessId: string, days = 30, limit = 20) {
  if (!Number.isInteger(days) || days < 7 || days > 365)
    throw new RangeError('Escolha entre 7 e 365 dias sem retorno.');
  const safeLimit = Math.max(1, Math.min(30, Math.trunc(limit)));
  const today = localNow().date;
  const cutoff = offsetDate(today, -days);
  const base = `FROM users u JOIN appointments a ON a.client_id=u.id
    AND a.business_id=u.business_id AND a.status='completed'
    WHERE u.business_id=? AND u.role='client'
    GROUP BY u.id HAVING MAX(a.date)<=?
      AND NOT EXISTS (SELECT 1 FROM appointments future WHERE future.business_id=u.business_id
        AND future.client_id=u.id AND future.date>=? AND future.status IN ('pending','confirmed'))`;
  const total = db.prepare(`SELECT COUNT(*) AS total FROM (SELECT u.id ${base})`)
    .get(businessId, cutoff, today) as { total: number };
  const rows = db.prepare(`SELECT u.name,MAX(a.date) AS last_visit,COUNT(a.id) AS completed_visits
    ${base} ORDER BY last_visit DESC,u.name LIMIT ?`)
    .all(businessId, cutoff, today, safeLimit) as Row[];
  return { days, asOf: today, total: total.total, shown: rows.length,
    clients: rows.map(row => ({ name: safeLabel(String(row.name)), lastVisit: row.last_visit,
      completedVisits: Number(row.completed_visits) })),
    definition: 'Cliente com último atendimento concluído há pelo menos o número de dias informado e sem agendamento futuro ativo.',
  };
}

export function getAssistantTopClients(businessId: string, request: AssistantRangeRequest = {}) {
  const range = resolveAssistantRange(request);
  const rows = db.prepare(`SELECT u.name,COUNT(a.id) AS completed_visits,
      COALESCE(SUM(a.price_cents),0) AS completed_value
    FROM appointments a JOIN users u ON u.id=a.client_id AND u.business_id=a.business_id
      AND u.role='client'
    WHERE a.business_id=? AND a.status='completed' AND a.date BETWEEN ? AND ?
    GROUP BY a.client_id ORDER BY completed_visits DESC,completed_value DESC LIMIT 10`)
    .all(businessId, range.from, range.to) as Row[];
  return { range, clients: rows.map(row => ({ name: safeLabel(String(row.name)),
    completedVisits: Number(row.completed_visits),
    completedServiceValue: money(Number(row.completed_value)) })),
    definition: 'Ranking por atendimentos concluídos. Valor representa preços dos serviços concluídos, não necessariamente dinheiro recebido.',
  };
}

const rangeInput = z.object({
  period: periodSchema.describe('Período relativo ao dia atual em São Paulo; use custom com from e to para datas exatas.'),
  from: z.string().optional().describe('Data inicial AAAA-MM-DD quando period=custom.'),
  to: z.string().optional().describe('Data final AAAA-MM-DD quando period=custom.'),
});
const guarded = <T>(read: () => T): T | { error: string } => {
  try { return read(); }
  catch (error) { return { error: error instanceof Error ? error.message : 'Consulta indisponível.' }; }
};

// Tool results are also sent to the model. With an external provider, keep
// client identities here and expose only request-local aliases to the model.
function externalResult(value: unknown, privacy: ExternalAssistantPrivacy,
  clientArray = false): unknown {
  if (Array.isArray(value)) return value.map(item => externalResult(item, privacy, clientArray));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === 'description') return [key, '[descrição omitida para privacidade]'];
      if (typeof item === 'string' && (key === 'clientName' || key === 'searchedName'
        || clientArray && key === 'name')) return [key, privacy.aliasClient(item)];
      return [key, externalResult(item, privacy, key === 'clients')];
    }));
  return typeof value === 'string' ? privacy.redactText(value) : value;
}

export function createAssistantDataTools(businessId: string, privacy?: ExternalAssistantPrivacy) {
  const protect = <T>(value: T): T => privacy ? externalResult(value, privacy) as T : value;
  return {
    consultar_financeiro: tool({
      description: 'Consulta entradas, despesas, saldo e evolução real dos lançamentos do Financeiro. Use para faturamento em qualquer período, inclusive datas específicas. Não calcula lucro líquido.',
      inputSchema: rangeInput,
      execute: input => guarded(() => protect(getAssistantFinance(businessId, input))),
    }),
    consultar_lancamentos: tool({
      description: 'Lista os lançamentos recentes de entrada ou despesa em um período, com data, descrição, categoria e valor. Use para localizar lançamentos específicos.',
      inputSchema: rangeInput.extend({
        type: z.enum(['all', 'income', 'expense']).optional(),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: input => guarded(() => protect(getAssistantFinanceEntries(businessId, input))),
    }),
    consultar_agenda: tool({
      description: 'Consulta agendamentos com cliente, serviço, data, hora e status. Use today para clientes do dia; next365 com limit=1 para a próxima cliente futura. Períodos next7/next30/next90/next365 excluem cancelamentos e faltas por padrão. Pode filtrar por nome e status.',
      inputSchema: rangeInput.extend({
        clientName: z.string().max(80).optional(),
        status: z.enum(['all','scheduled','pending','confirmed','completed','cancelled','no_show']).optional(),
        limit: z.number().int().min(1).max(40).optional(),
      }),
      execute: input => guarded(() => protect(getAssistantSchedule(businessId, {
        ...input, clientName: input.clientName && privacy
          ? privacy.originalClient(input.clientName) : input.clientName,
      }))),
    }),
    consultar_cliente: tool({
      description: 'Procura cliente pelo nome, inclusive sem acento, e retorna histórico resumido. Se houver mais de uma cliente com nome parecido, peça para a profissional especificar. Não retorna telefone, CPF ou e-mail.',
      inputSchema: z.object({ clientName: z.string().min(2).max(80) }),
      execute: input => guarded(() => protect(getAssistantClient(businessId,
        privacy ? privacy.originalClient(input.clientName) : input.clientName))),
    }),
    consultar_alteracoes: tool({
      description: 'Consulta eventos de cancelamento e remarcação, distinguindo ações da cliente e da profissional, no período informado. Motivos em texto livre não são expostos.',
      inputSchema: rangeInput.extend({
        actor: z.enum(['all','client','owner']).optional(),
        kind: z.enum(['all','cancelled','rescheduled','reschedule_requested']).optional(),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: input => guarded(() => protect(getAssistantEvents(businessId, input))),
    }),
    consultar_servicos: tool({
      description: 'Consulta serviços da profissional e desempenho por período: reservas, atendimentos concluídos, cancelamentos, faltas, preço atual e valor dos serviços concluídos.',
      inputSchema: rangeInput,
      execute: input => guarded(() => protect(getAssistantServices(businessId, input))),
    }),
    consultar_clientes_sem_retorno: tool({
      description: 'Lista clientes cujo último atendimento concluído foi há 7 a 365 dias e que não possuem agendamento futuro ativo.',
      inputSchema: z.object({ days: z.number().int().min(7).max(365), limit: z.number().int().min(1).max(30).optional() }),
      execute: input => guarded(() => protect(getAssistantInactiveClients(businessId, input.days, input.limit))),
    }),
    consultar_clientes_frequentes: tool({
      description: 'Mostra as clientes com mais atendimentos concluídos e o valor dos serviços concluídos no período.',
      inputSchema: rangeInput,
      execute: input => guarded(() => protect(getAssistantTopClients(businessId, input))),
    }),
  };
}

export type AssistantDataTools = ReturnType<typeof createAssistantDataTools>;
