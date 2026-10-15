PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  phone TEXT,
  specialties TEXT NOT NULL DEFAULT '[]',
  address TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '18:00',
  workdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
  slot_interval INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','client')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  cpf TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_in_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS users_business_email ON users(business_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS owner_email_global ON users(email) WHERE role='owner';
CREATE UNIQUE INDEX IF NOT EXISTS users_business_cpf ON users(business_id, cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_business_phone ON users(business_id, phone) WHERE phone IS NOT NULL AND role = 'client';
CREATE INDEX IF NOT EXISTS users_business_role ON users(business_id, role);

CREATE TABLE IF NOT EXISTS business_whatsapp_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('simulate','meta','disabled')),
  phone_number_id TEXT,
  sender TEXT,
  template_name TEXT,
  urgent_template_name TEXT,
  access_token_encrypted TEXT,
  app_secret_encrypted TEXT,
  webhook_key TEXT NOT NULL UNIQUE,
  webhook_verify_token TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('unhas','sobrancelhas','cilios','outros')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS services_business ON services(business_id,active);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  notes TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS appointments_schedule ON appointments(business_id,date,start_time,status);
CREATE INDEX IF NOT EXISTS appointments_client ON appointments(client_id,date);

CREATE TABLE IF NOT EXISTS appointment_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('client','owner')),
  kind TEXT NOT NULL CHECK (kind IN ('rescheduled','cancelled','reschedule_requested')),
  reason TEXT,
  previous_service_id TEXT,
  previous_date TEXT NOT NULL,
  previous_time TEXT NOT NULL,
  new_service_id TEXT,
  new_date TEXT,
  new_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS appointment_events_business_date ON appointment_events(business_id,created_at);
CREATE INDEX IF NOT EXISTS appointment_events_appointment ON appointment_events(appointment_id,created_at);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id TEXT UNIQUE REFERENCES appointments(id),
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS financial_entries_business_date ON financial_entries(business_id,date);

CREATE TABLE IF NOT EXISTS notification_outbox (
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
CREATE INDEX IF NOT EXISTS notifications_business ON notification_outbox(business_id,created_at);
