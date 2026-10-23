import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let directory: string;
let db: (typeof import('./db.js'))['db'];
let inbox: typeof import('./inbox.js');
const businessId = randomUUID();
const ownerId = randomUUID();
const clientId = randomUUID();
const serviceId = randomUUID();
const appointmentId = randomUUID();

describe('durable appointment inbox and reminders', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-inbox-test-'));
    process.env.DATABASE_PATH = join(directory, 'nayla.sqlite');
    process.env.WHATSAPP_MODE = 'simulate';
    ({ db } = await import('./db.js'));
    inbox = await import('./inbox.js');
    db.prepare(`INSERT INTO businesses(id,slug,name,specialties) VALUES(?,?,?,?)`)
      .run(businessId, 'inbox-test', 'Espaço Inbox', '["unhas"]');
    db.prepare(`INSERT INTO business_access(business_id,state,access_ends_at)
      VALUES(?,'active',?)`).run(businessId,Date.now()+365*86_400_000);
    db.prepare(`INSERT INTO users(id,business_id,role,name,email,password_hash)
      VALUES(?,?,'owner',?,?,?)`).run(ownerId, businessId, 'Dona', 'owner-inbox@example.test', 'hash');
    db.prepare(`INSERT INTO users(id,business_id,role,name,phone,cpf,password_hash,whatsapp_opt_in)
      VALUES(?,?,'client',?,?,?,?,1)`).run(clientId, businessId, 'Cliente',
        '11999991111', '12345678901', 'hash');
    db.prepare(`INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents)
      VALUES(?,?,?,'unhas',60,5000)`).run(serviceId, businessId, 'Manicure');
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,
      price_cents,whatsapp_opt_in) VALUES(?,?,?,?,?,?,?,5000,1)`)
      .run(appointmentId, businessId, clientId, serviceId,
        '2026-11-02', '15:00', '16:00');
    db.prepare(`UPDATE appointments SET created_at='2026-10-01 12:00:00' WHERE id=?`)
      .run(appointmentId);
  });

  after(() => {
    db?.close();
    if (directory?.startsWith(join(tmpdir(), 'nayla-inbox-test-')))
      rmSync(directory, { recursive: true, force: true });
  });

  it('keeps booking notices scoped to the owner and read status to its recipient', () => {
    const details = { businessId, appointmentId, clientName: 'Cliente',
      serviceName: 'Manicure', date: '2026-11-02', time: '15:00' };
    inbox.notifyOwnerOfBooking(details);
    inbox.notifyOwnerOfBooking(details);
    const ownerInbox = inbox.listInbox(ownerId, businessId);
    assert.equal(ownerInbox.unread, 1);
    assert.equal(ownerInbox.items.length, 1);
    assert.match(ownerInbox.items[0].message, /Manicure, 02\/11\/2026 às 15:00/);
    assert.equal('clientPhone' in ownerInbox.items[0], false);
    assert.equal('requiresResponse' in ownerInbox.items[0], false);
    assert.equal(inbox.listInbox(clientId, businessId).items.length, 0);
    assert.equal(inbox.markInboxRead(clientId, businessId, ownerInbox.items[0].id), false);
    assert.equal(inbox.markInboxRead(ownerId, businessId, ownerInbox.items[0].id), true);
    assert.equal(inbox.listInbox(ownerId, businessId).unread, 0);
  });

  it('prepares each reminder once across repeated sweeps, honors opt-out and retires stale schedules',
    async () => {
      const starts = inbox.saoPauloEpoch('2026-11-02', '15:00');
      assert.equal(new Date(starts).toISOString(), '2026-11-02T18:00:00.000Z');
      const first = await inbox.processDueReminders(new Date(starts - 24 * 60 * 60_000 + 60_000));
      assert.equal(first.queued, 1);
      assert.equal(first.processed, 1);
      const repeat = await inbox.processDueReminders(new Date(starts - 24 * 60 * 60_000 + 60_000));
      assert.equal(repeat.queued, 0);
      assert.equal(repeat.processed, 0);
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM notification_outbox
        WHERE appointment_id=? AND kind='reminder_day_before'`).get(appointmentId) as { count: number }).count, 1);
      assert.equal(inbox.listInbox(clientId, businessId).unread, 1);

      await inbox.processDueReminders(new Date(inbox.saoPauloEpoch('2026-11-02', '07:01')));
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM reminder_deliveries
        WHERE appointment_id=?`).get(appointmentId) as { count: number }).count, 2);

      db.prepare('UPDATE users SET whatsapp_opt_in=0 WHERE id=?').run(clientId);
      await inbox.processDueReminders(new Date(starts - 59 * 60_000));
      const hour = db.prepare(`SELECT status,message FROM notification_outbox
        WHERE appointment_id=? AND kind='reminder_hour_before'`).get(appointmentId) as
        { status: string; message: string };
      assert.equal(hour.status, 'opted_out');
      assert.match(hour.message, /Manicure/);
      assert.match(hour.message, /15:00/);
      assert.equal(inbox.listInbox(clientId, businessId).unread, 3);

      const eventId = randomUUID();
      db.prepare(`UPDATE appointments SET date='2026-11-03',start_time='15:00',end_time='16:00'
        WHERE id=?`).run(appointmentId);
      db.prepare(`INSERT INTO appointment_events(id,business_id,appointment_id,actor,kind,
        previous_service_id,previous_date,previous_time,new_service_id,new_date,new_time)
        VALUES(?,?,?,'client','rescheduled',?,?,?,?,?,?)`)
        .run(eventId, businessId, appointmentId, serviceId, '2026-11-02', '15:00',
          serviceId, '2026-11-03', '15:00');
      db.prepare(`UPDATE appointment_events SET created_at='2026-11-02 10:00:00'
        WHERE id=?`).run(eventId);
      inbox.notifyOfBookingChange({ businessId, appointmentId, clientId, actor: 'client',
        eventId, cancelled: false, clientName: 'Cliente', serviceName: 'Manicure',
        date: '2026-11-03', time: '15:00' });
      assert.equal(inbox.listInbox(clientId, businessId).items.length, 0);
      assert.equal(inbox.listInbox(ownerId, businessId).unread, 1);
      const nextStarts = inbox.saoPauloEpoch('2026-11-03', '15:00');
      await inbox.processDueReminders(new Date(nextStarts - 24 * 60 * 60_000 + 60_000));
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM reminder_deliveries
        WHERE appointment_id=? AND revision=1`).get(appointmentId) as { count: number }).count, 1);
      assert.equal(inbox.listInbox(clientId, businessId).unread, 1);
      db.prepare(`UPDATE appointments SET status='cancelled' WHERE id=?`).run(appointmentId);
      await inbox.processDueReminders(new Date(nextStarts - 59 * 60_000));
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM reminder_deliveries
        WHERE appointment_id=? AND revision=1`).get(appointmentId) as { count: number }).count, 1);
    });

  it('shows urgent contact only to the professional after a client change', () => {
    const urgentAppointmentId = randomUUID();
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,
      end_time,price_cents) VALUES(?,?,?,?,?,?,?,5000)`)
      .run(urgentAppointmentId, businessId, clientId, serviceId,
        '2026-12-01', '14:00', '15:00');
    inbox.notifyOfBookingChange({ businessId, appointmentId: urgentAppointmentId,
      clientId, actor: 'client', eventId: randomUUID(), cancelled: true,
      clientName: 'Cliente', serviceName: 'Manicure', date: '2026-12-01', time: '14:00' });
    const urgent = inbox.listInbox(ownerId, businessId).items
      .find(item => item.appointmentId === urgentAppointmentId);
    assert.equal(urgent?.requiresResponse, true);
    assert.equal(urgent?.clientPhone, '11999991111');

    inbox.notifyOfBookingChange({ businessId, appointmentId: urgentAppointmentId,
      clientId, actor: 'owner', eventId: randomUUID(), cancelled: false,
      clientName: 'Cliente', serviceName: 'Manicure', date: '2026-12-01', time: '14:00' });
    const clientNotice = inbox.listInbox(clientId, businessId).items
      .find(item => item.appointmentId === urgentAppointmentId);
    assert.ok(clientNotice);
    assert.equal('requiresResponse' in clientNotice, false);
    assert.equal('clientPhone' in clientNotice, false);
    assert.equal(inbox.listInbox(clientId, randomUUID()).items.length, 0);
  });

  it('does not send a 24-hour reminder for a booking made after that deadline', async () => {
    const lateId = randomUUID();
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,
      price_cents,whatsapp_opt_in,created_at) VALUES(?,?,?,?,?,?,?,5000,1,?)`)
      .run(lateId, businessId, clientId, serviceId, '2026-11-04', '15:00', '16:00',
        '2026-11-03 19:00:00');
    const starts = inbox.saoPauloEpoch('2026-11-04', '15:00');
    await inbox.processDueReminders(new Date(starts - 23 * 60 * 60_000));
    const count = (db.prepare(`SELECT COUNT(*) AS count FROM reminder_deliveries
      WHERE appointment_id=?`).get(lateId) as { count: number }).count;
    assert.equal(count, 0);
  });

  it('retains the day-of reminder for an unusually early appointment', async () => {
    const earlyId = randomUUID();
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,
      price_cents,whatsapp_opt_in,created_at) VALUES(?,?,?,?,?,?,?,5000,1,?)`)
      .run(earlyId, businessId, clientId, serviceId, '2026-11-05', '00:30', '01:30',
        '2026-11-05 02:45:00');
    await inbox.processDueReminders(new Date(inbox.saoPauloEpoch('2026-11-05', '00:05')));
    const phases = db.prepare(`SELECT phase FROM reminder_deliveries WHERE appointment_id=?`)
      .all(earlyId) as { phase: string }[];
    assert.deepEqual(phases.map(item => item.phase), ['day_of']);
  });

  it('does not prepare or send reminders while the professional is blocked', async () => {
    const blockedId = randomUUID();
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,
      price_cents,whatsapp_opt_in,created_at) VALUES(?,?,?,?,?,?,?,5000,1,?)`)
      .run(blockedId,businessId,clientId,serviceId,'2026-11-06','15:00','16:00',
        '2026-11-01 12:00:00');
    const starts = inbox.saoPauloEpoch('2026-11-06','15:00');
    db.prepare(`INSERT INTO reminder_deliveries(id,business_id,appointment_id,revision,phase,due_at)
      VALUES(?,?,?,0,'day_before',?)`).run(randomUUID(),businessId,blockedId,
        starts-24*60*60_000);
    db.prepare("UPDATE business_access SET state='blocked' WHERE business_id=?").run(businessId);
    const result = await inbox.processDueReminders(new Date(starts-24*60*60_000+60_000));
    assert.equal(result.queued,0);
    assert.equal((db.prepare(`SELECT status FROM reminder_deliveries WHERE appointment_id=?`)
      .get(blockedId) as {status:string}).status,'skipped');
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM notification_outbox WHERE appointment_id=?`)
      .get(blockedId) as {count:number}).count,0);
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM app_notifications WHERE appointment_id=?`)
      .get(blockedId) as {count:number}).count,0);
  });
});
