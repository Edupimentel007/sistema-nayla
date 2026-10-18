import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let database: typeof import('./db.js');
let queries: typeof import('./assistantDataTools.js');

function offsetDate(iso: string, days: number) {
  const value = new Date(`${iso}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

describe('Nayla read-only business tools', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-assistant-data-'));
    process.env.DATABASE_PATH = join(directory, 'nayla.sqlite');
    database = await import('./db.js');
    queries = await import('./assistantDataTools.js');
    const today = database.localNow().date;
    const oldDate = offsetDate(today, -31);
    for (const [id, slug] of [['b1', 'studio-um'], ['b2', 'studio-dois']])
      database.db.prepare('INSERT INTO businesses(id,slug,name) VALUES(?,?,?)')
        .run(id, slug, slug);
    for (const [id, businessId, name, phone, cpf] of [
      ['u1', 'b1', 'José Almeida', '11988887777', '12345678909'],
      ['u2', 'b1', 'Luiza Costa', '11977776666', '98765432100'],
      ['u3', 'b2', 'Marina Outra Conta', '11966665555', '11122233344'],
    ]) database.db.prepare(`INSERT INTO users(id,business_id,role,name,phone,cpf,password_hash)
      VALUES(?,?,'client',?,?,?,'hash')`).run(id, businessId, name, phone, cpf);
    for (const [id, businessId, name] of [
      ['s1', 'b1', 'Manicure',], ['s2', 'b2', 'Extensão de cílios'],
    ]) database.db.prepare(`INSERT INTO services
      (id,business_id,name,category,duration_minutes,price_cents)
      VALUES(?,?,?,'unhas',60,10000)`).run(id, businessId, name);
    for (const [id, businessId, clientId, serviceId, day, status, cents] of [
      ['a1', 'b1', 'u1', 's1', today, 'completed', 12345],
      ['a2', 'b1', 'u1', 's1', today, 'cancelled', 10000],
      ['a3', 'b1', 'u2', 's1', oldDate, 'completed', 8000],
      ['a4', 'b2', 'u3', 's2', today, 'completed', 900000],
    ]) database.db.prepare(`INSERT INTO appointments
      (id,business_id,client_id,service_id,date,start_time,end_time,status,price_cents)
      VALUES(?,?,?,?,?,'10:00','11:00',?,?)`)
      .run(id, businessId, clientId, serviceId, day, status, cents);
    for (const [id, businessId, type, cents] of [
      ['f1', 'b1', 'income', 12345], ['f2', 'b1', 'expense', 2000],
      ['f3', 'b2', 'income', 900000],
    ]) database.db.prepare(`INSERT INTO financial_entries
      (id,business_id,type,description,amount_cents,date) VALUES(?,?,?,'Teste',?,?)`)
      .run(id, businessId, type, cents, today);
    database.db.prepare(`INSERT INTO appointment_events
      (id,business_id,appointment_id,actor,kind,previous_date,previous_time,created_at)
      VALUES('e1','b1','a2','client','cancelled',?,'10:00',?)`)
      .run(today, `${today} 12:00:00`);
  });

  after(() => {
    database?.db.close();
    if (directory?.startsWith(join(tmpdir(), 'nayla-assistant-data-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('keeps financial values and schedule within the authenticated business', () => {
    const finance = queries.getAssistantFinance('b1', { period: 'today' });
    assert.equal(finance.income, 123.45);
    assert.equal(finance.expenses, 20);
    assert.equal(finance.balance, 103.45);
    assert.equal(queries.getAssistantFinance('b2', { period: 'today' }).income, 9000);
    const schedule = queries.getAssistantSchedule('b1', { period: 'today' });
    assert.equal(schedule.total, 2);
    assert.ok(schedule.appointments.every(row => row.clientName === 'José Almeida'));
    assert.equal(queries.getAssistantSchedule('b1', { period: 'today', clientName: 'marina' }).total, 0);
    const allResults = JSON.stringify({ finance, schedule });
    assert.ok(!allResults.includes('11988887777'));
    assert.ok(!allResults.includes('12345678909'));
    assert.ok(!allResults.includes('Marina Outra Conta'));
  });

  it('finds clients without accents and reports cancellation actor without sensitive fields', () => {
    const client = queries.getAssistantClient('b1', 'jose');
    assert.equal(client.totalMatches, 1);
    assert.equal(client.clients[0].completedVisits, 1);
    assert.equal(client.clients[0].cancellations, 1);
    assert.equal(client.appointments.length, 2);
    const events = queries.getAssistantEvents('b1', { period: 'today', actor: 'client', kind: 'cancelled' });
    assert.equal(events.total, 1);
    assert.equal(events.events[0].clientName, 'José Almeida');
    assert.equal(queries.getAssistantEvents('b2', { period: 'today' }).total, 0);
    assert.ok(!JSON.stringify({ client, events }).includes('11988887777'));
    assert.ok(!JSON.stringify({ client, events }).includes('12345678909'));
  });

  it('separates service value from cash and identifies clients without return', () => {
    const services = queries.getAssistantServices('b1', { period: 'today' });
    assert.equal(services.services[0].completedServiceValue, 123.45);
    assert.equal(services.services[0].cancelled, 1);
    const inactive = queries.getAssistantInactiveClients('b1', 30);
    assert.equal(inactive.total, 1);
    assert.equal(inactive.clients[0].name, 'Luiza Costa');
    const top = queries.getAssistantTopClients('b1', { period: 'today' });
    assert.equal(top.clients.length, 1);
    assert.equal(top.clients[0].name, 'José Almeida');
  });

  it('validates exact dates and bounds result windows', () => {
    const today = database.localNow().date;
    assert.deepEqual(queries.resolveAssistantRange({ period: 'custom', from: today, to: today }).days, 1);
    assert.throws(() => queries.resolveAssistantRange({ period: 'custom', from: '2026-02-30', to: today }), RangeError);
    assert.throws(() => queries.resolveAssistantRange({ period: 'custom', from: '2020-01-01', to: today }), RangeError);
    assert.throws(() => queries.getAssistantInactiveClients('b1', 400), RangeError);
  });

  it('reads new entries immediately and redacts personal data in descriptions', () => {
    const today = database.localNow().date;
    const before = queries.getAssistantFinance('b1', { period: 'today' }).income;
    database.db.prepare(`INSERT INTO financial_entries
      (id,business_id,type,description,amount_cents,date)
      VALUES('f4','b1','income','Contato 11988887777 CPF 123.456.789-09',5000,?)`).run(today);
    try {
      assert.equal(queries.getAssistantFinance('b1', { period: 'today' }).income, before + 50);
      const entry = queries.getAssistantFinanceEntries('b1', { period: 'today', type: 'income' });
      assert.equal(entry.total, 2);
      assert.ok(!JSON.stringify(entry).includes('11988887777'));
      assert.ok(!JSON.stringify(entry).includes('123.456.789-09'));
      assert.ok(entry.entries.some(row => String(row.description).includes('[dado oculto]')));
    } finally {
      database.db.prepare("DELETE FROM financial_entries WHERE id='f4'").run();
    }
  });

  it('finds the next active appointment beyond 90 days without returning cancellations', () => {
    const future = offsetDate(database.localNow().date, 120);
    database.db.prepare(`INSERT INTO appointments
      (id,business_id,client_id,service_id,date,start_time,end_time,status,price_cents)
      VALUES('a5','b1','u1','s1',?,'13:00','14:00','confirmed',10000)`).run(future);
    try {
      assert.equal(queries.getAssistantSchedule('b1', { period: 'next90' }).total, 0);
      const next = queries.getAssistantSchedule('b1', { period: 'next365', limit: 1 });
      assert.equal(next.total, 1);
      assert.equal(next.appointments[0].date, future);
      assert.equal(next.appointments[0].clientName, 'José Almeida');
    } finally {
      database.db.prepare("DELETE FROM appointments WHERE id='a5'").run();
    }
  });
});
