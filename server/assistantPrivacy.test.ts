import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let database: typeof import('./db.js');
let privacyModule: typeof import('./assistantPrivacy.js');
let toolsModule: typeof import('./assistantDataTools.js');

describe('Nayla external model data minimization', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-assistant-privacy-'));
    process.env.DATABASE_PATH = join(directory, 'nayla.sqlite');
    database = await import('./db.js');
    privacyModule = await import('./assistantPrivacy.js');
    toolsModule = await import('./assistantDataTools.js');
    for (const [id, name] of [['b1', 'Espaço de Ana'], ['b2', 'Outro espaço']])
      database.db.prepare('INSERT INTO businesses(id,slug,name) VALUES(?,?,?)')
        .run(id, id, name);
    for (const [id, businessId, name, phone, cpf] of [
      ['u1', 'b1', 'José Almeida', '11988887777', '12345678909'],
      ['u2', 'b1', 'Luiza Costa', '11977776666', '98765432100'],
      ['u3', 'b2', 'Marina Outra Conta', '11966665555', '11122233344'],
    ]) database.db.prepare(`INSERT INTO users(id,business_id,role,name,phone,cpf,password_hash)
      VALUES(?,?,'client',?,?,?,'hash')`).run(id, businessId, name, phone, cpf);
    database.db.prepare(`INSERT INTO services
      (id,business_id,name,category,duration_minutes,price_cents)
      VALUES('s1','b1','Manicure','unhas',60,10000)`).run();
    database.db.prepare(`INSERT INTO appointments
      (id,business_id,client_id,service_id,date,start_time,end_time,status,price_cents)
      VALUES('a1','b1','u1','s1',?,'10:00','11:00','confirmed',10000)`)
      .run(database.localNow().date);
    database.db.prepare(`INSERT INTO financial_entries
      (id,business_id,type,description,category,amount_cents,date)
      VALUES('f1','b1','income','Pagamento de José Almeida, CPF 123.456.789-09',
        'Serviço',10000,?)`).run(database.localNow().date);
  });

  after(() => {
    database?.db.close();
    if (directory?.startsWith(join(tmpdir(), 'nayla-assistant-privacy-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('redacts identifiers from the current message and saved history', () => {
    const privacy = privacyModule.createExternalAssistantPrivacy('b1', 'Espaço de Ana', 'b1');
    const safe = privacy.redactText(`Quando o jose almeida volta? Telefone 11988887777,
      CPF 123.456.789-09, email jose@example.com, token: gsk_1234567890123456,
      cartão 4111 1111 1111 1111; no Espaço de Ana, /agendar/b1.`);
    assert.match(safe, /NAYLA_CLIENTE_1/);
    assert.match(safe, /MEU_ESPACO/);
    assert.match(safe, /NAYLA_LINK_AGENDAMENTO/);
    assert.doesNotMatch(safe, /José|jose|11988887777|123\.456\.789-09|jose@example|gsk_|4111 1111/);
    assert.equal(privacy.originalClient('NAYLA_CLIENTE_1'), 'José Almeida');
    assert.equal(privacy.restoreAnswer('Próximo horário de NAYLA_CLIENTE_1: NAYLA_LINK_AGENDAMENTO.'),
      'Próximo horário de José Almeida: /agendar/b1.');
    assert.doesNotMatch(privacy.redactText('Marina Outra Conta'), /NAYLA_CLIENTE/);
  });

  it('keeps aggregate amounts but hides names and financial descriptions in tool results', async () => {
    const privacy = privacyModule.createExternalAssistantPrivacy('b1', 'Espaço de Ana');
    const tools = toolsModule.createAssistantDataTools('b1', privacy);
    const schedule = await (tools.consultar_agenda.execute as Function)({ period: 'today' });
    assert.equal(schedule.appointments[0].clientName, 'NAYLA_CLIENTE_1');
    assert.equal(schedule.appointments[0].servicePrice, 100);
    const matched = await (tools.consultar_cliente.execute as Function)(
      { clientName: 'NAYLA_CLIENTE_1' });
    assert.equal(matched.totalMatches, 1);
    assert.equal(matched.clients[0].name, 'NAYLA_CLIENTE_1');
    const entries = await (tools.consultar_lancamentos.execute as Function)(
      { period: 'today' });
    assert.equal(entries.entries[0].amount, 100);
    assert.equal(entries.entries[0].description, '[descrição omitida para privacidade]');
    const externalPayload = JSON.stringify({ schedule, matched, entries });
    assert.doesNotMatch(externalPayload,
      /José Almeida|Luiza Costa|Marina Outra Conta|123\.456\.789-09|11988887777/);
  });
});
