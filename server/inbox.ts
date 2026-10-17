import { db, id } from './db.js';
import { sendAppointmentReminder, type ReminderPhase } from './notifications.js';

type Row = Record<string, any>;
const zone = 'America/Sao_Paulo';
const hourMs = 60 * 60_000;

// The migrations live here so existing installations gain the inbox on restart.
db.exec(`CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS app_notifications_recipient
  ON app_notifications(recipient_user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('day_before','day_of','hour_before')),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(appointment_id,revision,phase)
);
CREATE INDEX IF NOT EXISTS reminder_deliveries_pending ON reminder_deliveries(status,due_at);`);

function timestamp(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${local.year}-${local.month}-${local.day}`,
    time: `${local.hour}:${local.minute}` };
}

// Resolve a Sao Paulo wall-clock time without relying on the host machine timezone.
export function saoPauloEpoch(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = expected + 3 * hourMs;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = timestamp(new Date(candidate));
    const [ly, lm, ld] = local.date.split('-').map(Number);
    const [lh, lmin] = local.time.split(':').map(Number);
    const difference = expected - Date.UTC(ly, lm - 1, ld, lh, lmin);
    if (!difference) break;
    candidate += difference;
  }
  return candidate;
}

function dateLabel(date: string) { return date.split('-').reverse().join('/'); }
function details(service: string, date: string, time: string) {
  return `${service}, ${dateLabel(date)} às ${time}`;
}

function addNotification(input: { businessId: string; recipientUserId: string;
  appointmentId: string; kind: string; title: string; message: string; dedupeKey: string }) {
  return db.prepare(`INSERT OR IGNORE INTO app_notifications
    (id,business_id,recipient_user_id,appointment_id,kind,title,message,dedupe_key)
    VALUES(?,?,?,?,?,?,?,?)`).run(id(), input.businessId, input.recipientUserId,
    input.appointmentId, input.kind, input.title, input.message, input.dedupeKey).changes > 0;
}

export function notifyOwnerOfBooking(input: { businessId: string; appointmentId: string;
  clientName: string; serviceName: string; date: string; time: string }) {
  const owner = db.prepare(`SELECT id FROM users WHERE business_id=? AND role='owner' LIMIT 1`)
    .get(input.businessId) as { id: string } | undefined;
  if (!owner) return;
  addNotification({ businessId: input.businessId, appointmentId: input.appointmentId,
    recipientUserId: owner.id, kind: 'new_booking', title: 'Novo agendamento',
    message: `${input.clientName} agendou ${details(input.serviceName, input.date, input.time)}.`,
    dedupeKey: `booking:${input.appointmentId}` });
}

export function notifyOfBookingChange(input: { businessId: string; appointmentId: string;
  clientId: string; actor: 'owner' | 'client'; eventId: string; cancelled: boolean;
  clientName: string; serviceName: string; date: string; time: string }) {
  const recipient = input.actor === 'client'
    ? db.prepare(`SELECT id FROM users WHERE business_id=? AND role='owner' LIMIT 1`)
      .get(input.businessId) as { id: string } | undefined
    : { id: input.clientId };
  if (!recipient) return;
  const subject = input.actor === 'client' ? input.clientName : 'A profissional';
  const action = input.cancelled ? 'cancelou' : 'alterou';
  const title = input.cancelled ? 'Agendamento cancelado' : 'Agendamento alterado';
  addNotification({ businessId: input.businessId, appointmentId: input.appointmentId,
    recipientUserId: recipient.id,
    kind: input.cancelled ? 'booking_cancelled' : 'booking_changed', title,
    message: `${subject} ${action} ${details(input.serviceName, input.date, input.time)}.`,
    dedupeKey: `change:${input.eventId}:${recipient.id}` });
  db.prepare(`UPDATE app_notifications SET superseded_at=CURRENT_TIMESTAMP
    WHERE appointment_id=? AND kind LIKE 'reminder_%' AND superseded_at IS NULL`)
    .run(input.appointmentId);
  db.prepare(`UPDATE reminder_deliveries SET status='skipped',updated_at=CURRENT_TIMESTAMP
    WHERE appointment_id=? AND status='pending'`).run(input.appointmentId);
}

export function listInbox(userId: string, businessId: string, limit = 50) {
  const unread = (db.prepare(`SELECT COUNT(*) AS count FROM app_notifications
    WHERE business_id=? AND recipient_user_id=? AND read_at IS NULL AND superseded_at IS NULL`)
    .get(businessId, userId) as { count: number }).count;
  const rows = db.prepare(`SELECT id,appointment_id,kind,title,message,read_at,created_at
    FROM app_notifications WHERE business_id=? AND recipient_user_id=? AND superseded_at IS NULL
    ORDER BY created_at DESC,rowid DESC LIMIT ?`).all(businessId, userId, limit) as Row[];
  return { unread, items: rows.map(row => ({ id: row.id, appointmentId: row.appointment_id,
    kind: row.kind, title: row.title, message: row.message,
    readAt: row.read_at, createdAt: row.created_at })) };
}

export function markInboxRead(userId: string, businessId: string, notificationId: string) {
  return db.prepare(`UPDATE app_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
    WHERE id=? AND business_id=? AND recipient_user_id=? AND superseded_at IS NULL`)
    .run(notificationId, businessId, userId).changes > 0;
}

function reminderPlan(date: string, time: string) {
  const starts = saoPauloEpoch(date, time);
  const [hour, minute] = time.split(':').map(Number);
  const dayOfMinute = Math.min(7 * 60, hour * 60 + minute - 120);
  const dayOfHour = Math.floor(Math.max(0, dayOfMinute) / 60);
  const dayOfMinutes = Math.max(0, dayOfMinute) % 60;
  const dayOfTime = `${String(dayOfHour).padStart(2, '0')}:${String(dayOfMinutes).padStart(2, '0')}`;
  const dayOfDue = saoPauloEpoch(date, dayOfTime);
  const dayOfCutoff = starts - 90 * 60_000;
  return [
    { phase: 'day_before' as const, due: starts - 24 * hourMs,
      until: Math.min(starts - 4 * hourMs, starts - 22 * hourMs) },
    { phase: 'day_of' as const, due: dayOfDue,
      until: dayOfCutoff > dayOfDue ? Math.min(dayOfCutoff, dayOfDue + 2 * hourMs) : starts },
    { phase: 'hour_before' as const, due: starts - hourMs, until: starts },
  ];
}

function currentRevision(appointmentId: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM appointment_events
    WHERE appointment_id=? AND kind='rescheduled'`).get(appointmentId) as { count: number }).count;
}

function reminderCopy(phase: ReminderPhase, service: string, date: string, time: string) {
  const prefix = phase === 'day_before' ? 'Amanhã é seu atendimento' :
    phase === 'day_of' ? 'Seu atendimento é hoje' : 'Seu atendimento começa em 1 hora';
  return `${prefix}: ${details(service, date, time)}.`;
}

export async function processDueReminders(now = new Date()) {
  const nowMs = now.getTime();
  const local = timestamp(now);
  const start = new Date(`${local.date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 2);
  const untilDate = start.toISOString().slice(0, 10);
  const appointments = db.prepare(`SELECT a.id,a.business_id,a.client_id,a.date,a.start_time,a.created_at,
      COALESCE((SELECT MAX(e.created_at) FROM appointment_events e
        WHERE e.appointment_id=a.id AND e.kind='rescheduled'),a.created_at) AS schedule_changed_at,
      a.status,u.name AS client_name,u.phone AS client_phone,s.name AS service_name
    FROM appointments a JOIN users u ON u.id=a.client_id JOIN services s ON s.id=a.service_id
    WHERE a.date BETWEEN ? AND ? AND a.status IN ('pending','confirmed')`)
    .all(local.date, untilDate) as Row[];
  let queued = 0;
  db.transaction(() => {
    for (const appointment of appointments) {
      const revision = currentRevision(appointment.id);
      for (const plan of reminderPlan(appointment.date, appointment.start_time)) {
        if (nowMs < plan.due || nowMs >= plan.until) continue;
        const lastChange = Date.parse(`${appointment.schedule_changed_at.replace(' ', 'T')}Z`);
        if (Number.isFinite(lastChange) && lastChange > plan.due) continue;
        const text = reminderCopy(plan.phase, appointment.service_name,
          appointment.date, appointment.start_time);
        addNotification({ businessId: appointment.business_id,
          recipientUserId: appointment.client_id, appointmentId: appointment.id,
          kind: `reminder_${plan.phase}`, title: plan.phase === 'day_before'
            ? 'Lembrete para amanhã' : plan.phase === 'day_of'
              ? 'Lembrete para hoje' : 'Falta 1 hora', message: text,
          dedupeKey: `reminder:${appointment.id}:${revision}:${plan.phase}` });
        const inserted = db.prepare(`INSERT OR IGNORE INTO reminder_deliveries
          (id,business_id,appointment_id,revision,phase,due_at) VALUES(?,?,?,?,?,?)`)
          .run(id(), appointment.business_id, appointment.id, revision, plan.phase, plan.due);
        queued += inserted.changes;
      }
    }
  }).immediate();

  // A crashed worker may leave a claimed delivery uncertain. Never automatically
  // resend it: the provider might have accepted it before the process died.
  db.prepare(`UPDATE reminder_deliveries SET status='uncertain',updated_at=CURRENT_TIMESTAMP
    WHERE status='sending' AND updated_at < datetime('now','-10 minutes')`).run();
  const jobs = db.prepare(`SELECT d.id,d.appointment_id,d.revision,d.phase,a.business_id,a.client_id,
      a.date,a.start_time,a.status,u.name AS client_name,u.phone AS client_phone,
      s.name AS service_name
    FROM reminder_deliveries d JOIN appointments a ON a.id=d.appointment_id
    JOIN users u ON u.id=a.client_id JOIN services s ON s.id=a.service_id
    WHERE d.status='pending' AND d.due_at<=? ORDER BY d.due_at,d.id LIMIT 100`)
    .all(nowMs) as Row[];
  let processed = 0;
  for (const job of jobs) {
    const claimed = db.prepare(`UPDATE reminder_deliveries SET status='sending',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'`).run(job.id).changes;
    if (!claimed) continue;
    const plan = reminderPlan(job.date, job.start_time)
      .find(item => item.phase === job.phase);
    if (!plan || job.status !== 'pending' && job.status !== 'confirmed' ||
      currentRevision(job.appointment_id) !== job.revision || nowMs >= plan.until) {
      db.prepare(`UPDATE reminder_deliveries SET status='skipped',updated_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(job.id);
      continue;
    }
    try {
      const status = await sendAppointmentReminder({ businessId: job.business_id,
        appointmentId: job.appointment_id, recipient: job.client_phone,
        clientName: job.client_name, serviceName: job.service_name,
        date: job.date, time: job.start_time, phase: job.phase as ReminderPhase });
      db.prepare(`UPDATE reminder_deliveries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(status || 'skipped', job.id);
    } catch {
      db.prepare(`UPDATE reminder_deliveries SET status='failed',updated_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(job.id);
    }
    processed++;
  }
  return { queued, processed };
}

export function startReminderWorker() {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void processDueReminders().catch(error =>
      console.error('Falha ao processar lembretes', error)).finally(() => { running = false; });
  };
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
