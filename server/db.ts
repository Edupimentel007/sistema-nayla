import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
  ['appointments', 'updated_at', 'TEXT'],
  ['appointments', 'notes', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some(existing => existing.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
