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

CREATE TABLE IF NOT EXISTS business_logos (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  image_data BLOB NOT NULL,
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  google_subject TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS users_business_email ON users(business_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS owner_email_global ON users(email) WHERE role='owner';
CREATE UNIQUE INDEX IF NOT EXISTS users_business_cpf ON users(business_id, cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_business_phone ON users(business_id, phone) WHERE phone IS NOT NULL AND role = 'client';
CREATE INDEX IF NOT EXISTS users_business_role ON users(business_id, role);

-- Access is granted by Nayla's operator, never by a client-side trial action.
CREATE TABLE IF NOT EXISTS business_access (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','trial','active','blocked')),
  trial_started_at INTEGER,
  trial_ends_at INTEGER,
  access_ends_at INTEGER,
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS super_admin_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  promoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS owner_devices (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id,device_hash)
);
CREATE INDEX IF NOT EXISTS owner_devices_hash ON owner_devices(device_hash);
-- HMAC claims survive account deletion so a new account cannot restart a trial.
CREATE TABLE IF NOT EXISTS trial_identity_claims (
  identity_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone','device')),
  business_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS access_audit (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('trial_granted','access_granted','access_extended','access_blocked')),
  previous_state TEXT,
  new_state TEXT NOT NULL,
  previous_ends_at INTEGER,
  new_ends_at INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS access_audit_business_created ON access_audit(business_id,created_at DESC);

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

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_conversations_owner_updated
  ON assistant_conversations(business_id,owner_user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_messages_conversation
  ON assistant_messages(conversation_id,created_at);

CREATE TABLE IF NOT EXISTS assistant_ai_daily_usage (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (business_id,day)
);

CREATE TABLE IF NOT EXISTS assistant_ai_global_usage (
  day_utc TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0)
);

CREATE TABLE IF NOT EXISTS google_oauth_flows (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','client')),
  business_id TEXT,
  slug TEXT,
  remember INTEGER NOT NULL DEFAULT 0,
  mobile INTEGER NOT NULL DEFAULT 0,
  app_nonce TEXT,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_oauth_tickets (
  ticket_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner','client')),
  business_id TEXT,
  slug TEXT,
  google_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  mobile INTEGER NOT NULL DEFAULT 0,
  app_nonce TEXT,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN (
    'unhas','sobrancelhas','cilios','cabelos','terapia_capilar','maquiagem',
    'depilacao','estetica_facial','estetica_corporal','massagens',
    'micropigmentacao','bronzeamento','podologia','outros')),
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

CREATE TABLE IF NOT EXISTS assistant_action_results (
  event_id TEXT PRIMARY KEY REFERENCES appointment_events(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES assistant_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id TEXT UNIQUE REFERENCES appointments(id),
    prepaid_appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
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
