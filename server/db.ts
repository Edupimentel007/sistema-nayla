import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const defaultPath = resolve(process.cwd(), 'database', 'nayla.sqlite');
const databasePath = resolve(process.env.DATABASE_PATH || defaultPath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const schemaPath = fileURLToPath(new URL('../database/schema.sql', import.meta.url));
db.exec(readFileSync(schemaPath, 'utf8'));
for (const [table, column, definition] of [
  ['businesses', 'description', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'notes', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'tags', "TEXT NOT NULL DEFAULT '[]'"],
  ['users', 'whatsapp_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'whatsapp_opt_in_at', 'TEXT'],
  ['appointments', 'updated_at', 'TEXT'],
  ['appointments', 'notes', "TEXT NOT NULL DEFAULT ''"],
  ['appointments', 'whatsapp_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
  ['notification_outbox', 'phone_number_id', 'TEXT'],
  ['notification_outbox', 'kind', "TEXT NOT NULL DEFAULT 'booking_confirmation'"],
  ['business_whatsapp_settings', 'app_secret_encrypted', 'TEXT'],
  ['business_whatsapp_settings', 'urgent_template_name', 'TEXT'],
  ['business_whatsapp_settings', 'webhook_key', 'TEXT'],
  ['business_whatsapp_settings', 'webhook_verify_token', 'TEXT'],
] as const) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some(existing => existing.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
const webhookRows = db.prepare(`SELECT business_id FROM business_whatsapp_settings
  WHERE webhook_key IS NULL OR webhook_verify_token IS NULL`).all() as { business_id: string }[];
for (const row of webhookRows) db.prepare(`UPDATE business_whatsapp_settings
  SET webhook_key=COALESCE(webhook_key,?),webhook_verify_token=COALESCE(webhook_verify_token,?)
  WHERE business_id=?`).run(randomBytes(24).toString('hex'), randomBytes(24).toString('hex'), row.business_id);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS business_whatsapp_webhook_key ON business_whatsapp_settings(webhook_key)');
const outboxSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notification_outbox'")
  .get() as { sql: string } | undefined;
if (outboxSchema && !outboxSchema.sql.includes("'opted_out'")) {
  db.transaction(() => {
    db.exec(`CREATE TABLE notification_outbox_new (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      kind TEXT NOT NULL DEFAULT 'booking_confirmation',
      recipient TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','accepted','sent','delivered','read','failed','not_configured','simulated','opted_out')),
      phone_number_id TEXT,
      provider_message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO notification_outbox_new
      (id,business_id,appointment_id,channel,kind,recipient,message,status,phone_number_id,provider_message_id,error,created_at,updated_at)
      SELECT id,business_id,appointment_id,channel,kind,recipient,message,status,phone_number_id,provider_message_id,error,created_at,updated_at
      FROM notification_outbox;
    DROP TABLE notification_outbox;
    ALTER TABLE notification_outbox_new RENAME TO notification_outbox;
    CREATE INDEX notifications_business ON notification_outbox(business_id,created_at);
    CREATE INDEX notifications_provider_message ON notification_outbox(provider_message_id)
      WHERE provider_message_id IS NOT NULL;`);
  })();
} else {
  db.exec(`CREATE INDEX IF NOT EXISTS notifications_provider_message ON notification_outbox(provider_message_id)
    WHERE provider_message_id IS NOT NULL`);
}
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

export const id = () => randomUUID();

export function localNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export function fromCents(amount: number) {
  return amount / 100;
}

export function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function dateAgo(days: number) {
  const today = localNow().date;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
