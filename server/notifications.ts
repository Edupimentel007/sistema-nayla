import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, id } from './db.js';

type Row = Record<string, any>;
export type WhatsAppMode = 'disabled' | 'simulate' | 'meta';
export type NotificationStatus = 'pending' | 'opted_out' | 'simulated' | 'not_configured' |
  'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export class NotificationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function encryptionKey() {
  const encoded = process.env.WHATSAPP_ENCRYPTION_KEY;
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded.trim()) return null;
  return key;
}

function encryptSecret(plain: string, businessId: string) {
  const key = encryptionKey();
  if (!key) throw new NotificationError(503, 'Configure WHATSAPP_ENCRYPTION_KEY com 32 bytes em base64 no servidor.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(businessId));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${nonce.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function decryptSecret(ciphertext: string | null, businessId: string) {
  if (!ciphertext) return null;
  const key = encryptionKey();
  if (!key) throw new NotificationError(503, 'Chave de criptografia do WhatsApp indisponível.');
  const [version, nonce, tag, data] = ciphertext.split(':');
  if (version !== 'v1' || !nonce || !tag || !data) throw new NotificationError(503, 'Credencial WhatsApp inválida.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAAD(Buffer.from(businessId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new NotificationError(503, 'Não foi possível ler a credencial WhatsApp salva.'); }
}

function defaultMode(): WhatsAppMode {
  const mode = process.env.WHATSAPP_MODE;
  return mode === 'simulate' || mode === 'meta' || mode === 'disabled' ? mode : 'disabled';
}

export function ensureWhatsAppSettings(businessId: string): Row {
  db.prepare(`INSERT OR IGNORE INTO business_whatsapp_settings
    (business_id,mode,webhook_key,webhook_verify_token) VALUES(?,?,?,?)`)
    .run(businessId, defaultMode(), randomBytes(24).toString('hex'), randomBytes(24).toString('hex'));
  return db.prepare('SELECT * FROM business_whatsapp_settings WHERE business_id=?').get(businessId) as Row;
}

function metaReady(row: Row) {
  if (row.mode !== 'meta' || !row.phone_number_id || !row.template_name ||
    !row.access_token_encrypted || !row.app_secret_encrypted || !encryptionKey()) return false;
  try {
    return Boolean(decryptSecret(row.access_token_encrypted, row.business_id) &&
      decryptSecret(row.app_secret_encrypted, row.business_id));
  } catch { return false; }
}

export function whatsAppConfig(businessId: string, origin: string) {
  const row = ensureWhatsAppSettings(businessId);
  return {
    mode: row.mode as WhatsAppMode,
    configured: metaReady(row),
    templateName: row.template_name || null,
    sender: row.sender || null,
    senderVerified: false,
    phoneNumberId: row.phone_number_id || null,
    hasAccessToken: Boolean(row.access_token_encrypted),
    hasAppSecret: Boolean(row.app_secret_encrypted),
    webhookConfigured: Boolean(row.app_secret_encrypted && row.webhook_key && row.webhook_verify_token),
    webhookUrl: `${origin.replace(/\/$/, '')}/api/webhooks/whatsapp/${row.webhook_key}`,
    webhookVerifyToken: row.webhook_verify_token as string,
  };
}

export type ConfigUpdate = {
  mode: WhatsAppMode;
  templateName: string;
  sender: string;
  phoneNumberId: string;
  accessToken?: string | null;
  appSecret?: string | null;
};

export function updateWhatsAppSettings(businessId: string, input: ConfigUpdate, origin: string) {
  const previous = ensureWhatsAppSettings(businessId);
  const accessToken = input.accessToken === null ? null : input.accessToken?.trim()
    ? encryptSecret(input.accessToken.trim(), businessId) : previous.access_token_encrypted;
  const appSecret = input.appSecret === null ? null : input.appSecret?.trim()
    ? encryptSecret(input.appSecret.trim(), businessId) : previous.app_secret_encrypted;
  db.prepare(`UPDATE business_whatsapp_settings
    SET mode=?,template_name=?,sender=?,phone_number_id=?,access_token_encrypted=?,
      app_secret_encrypted=?,updated_at=CURRENT_TIMESTAMP WHERE business_id=?`)
    .run(input.mode, input.templateName.trim() || null, input.sender.trim() || null,
      input.phoneNumberId.trim() || null, accessToken, appSecret, businessId);
  return whatsAppConfig(businessId, origin);
}

export type Confirmation = {
  businessId: string;
  appointmentId: string;
  recipient: string;
  clientName: string;
  serviceName: string;
  date: string;
  time: string;
};

function recipientNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
  if (/^55\d{10,11}$/.test(digits)) return digits;
  return null;
}

export async function sendBookingConfirmation(details: Confirmation): Promise<NotificationStatus> {
  const business = db.prepare('SELECT name FROM businesses WHERE id=?').get(details.businessId) as Row | undefined;
  const consent = db.prepare(`SELECT a.whatsapp_opt_in AS booking_consent,u.whatsapp_opt_in AS client_consent
    FROM appointments a JOIN users u ON u.id=a.client_id
    WHERE a.id=? AND a.business_id=?`).get(details.appointmentId, details.businessId) as Row | undefined;
  if (!business || !consent) throw new NotificationError(404, 'Agendamento não encontrado.');
  const settings = ensureWhatsAppSettings(details.businessId);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${details.date}T12:00:00Z`));
  const formattedDate = details.date.split('-').reverse().join('/');
  const message = `Olá, ${details.clientName}! Seu agendamento com ${business.name} para ${details.serviceName} está confirmado: ${weekday}, ${formattedDate}, às ${details.time}. Até lá!`;
  const recipient = recipientNumber(details.recipient);
  const consentGranted = Boolean(consent.booking_consent && consent.client_consent);
  const initialStatus: NotificationStatus = !consentGranted ? 'opted_out' :
    settings.mode === 'simulate' ? 'simulated' :
      settings.mode !== 'meta' || !metaReady(settings) ? 'not_configured' :
        !recipient ? 'failed' : 'pending';
  const notificationId = id();
  db.prepare(`INSERT INTO notification_outbox
    (id,business_id,appointment_id,recipient,message,status,phone_number_id,error)
    VALUES(?,?,?,?,?,?,?,?)`).run(notificationId, details.businessId, details.appointmentId,
      recipient || details.recipient, message, initialStatus, settings.phone_number_id || null,
      !recipient && consentGranted && settings.mode === 'meta' ? 'Telefone inválido para envio.' : null);
  if (initialStatus !== 'pending') return initialStatus;

  try {
    const token = decryptSecret(settings.access_token_encrypted, details.businessId);
    if (!token) throw new Error('Token Meta ausente.');
    const graphVersion = /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION || '')
      ? process.env.WHATSAPP_GRAPH_VERSION : 'v23.0';
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${settings.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: recipient, type: 'template',
        template: {
          name: settings.template_name,
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [
            details.clientName, business.name, details.serviceName, weekday, formattedDate, details.time,
          ].map(text => ({ type: 'text', text })) }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json() as { messages?: { id: string }[]; error?: { message?: string } };
    if (!response.ok || !result.messages?.[0]?.id)
      throw new Error(result.error?.message || `Meta HTTP ${response.status}`);
    db.prepare(`UPDATE notification_outbox SET status='accepted',provider_message_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND business_id=?`).run(result.messages[0].id, notificationId, details.businessId);
    return 'accepted';
  } catch (error) {
    db.prepare(`UPDATE notification_outbox SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND business_id=?`).run(String(error).slice(0, 500), notificationId, details.businessId);
    return 'failed';
  }
}

export function webhookSettings(webhookKey: string): Row | undefined {
  return db.prepare('SELECT * FROM business_whatsapp_settings WHERE webhook_key=?')
    .get(webhookKey) as Row | undefined;
}

export function verifyWebhookChallenge(settings: Row, suppliedToken: string) {
  const expected = Buffer.from(settings.webhook_verify_token || '');
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function verifyWebhookSignature(settings: Row, signature: string, rawBody: Buffer) {
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  try {
    const secret = decryptSecret(settings.app_secret_encrypted, settings.business_id);
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature.slice(7), 'hex');
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch { return false; }
}

export function applyWebhookStatuses(settings: Row, body: unknown) {
  if (!body || typeof body !== 'object') return 0;
  const entries = (body as Row).entry;
  if (!Array.isArray(entries)) return 0;
  const rank: Record<string, number> = {
    pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4,
  };
  let updated = 0;
  for (const entry of entries.slice(0, 100)) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes.slice(0, 20)) {
      const value = change?.value;
      if (String(value?.metadata?.phone_number_id || '') !== String(settings.phone_number_id || '')) continue;
      if (!Array.isArray(value?.statuses)) continue;
      for (const item of value.statuses.slice(0, 100)) {
        const status = item?.status;
        const providerId = item?.id;
        if (!['sent', 'delivered', 'read', 'failed'].includes(status) || typeof providerId !== 'string') continue;
        const existing = db.prepare(`SELECT id,status FROM notification_outbox
          WHERE business_id=? AND phone_number_id=? AND provider_message_id=?`)
          .get(settings.business_id, settings.phone_number_id, providerId) as Row | undefined;
        if (!existing || existing.status === 'read' || existing.status === 'delivered' && status === 'failed') continue;
        if (status !== 'failed' && rank[status] <= (rank[existing.status] ?? -1)) continue;
        const error = status === 'failed' ? JSON.stringify(item.errors || []).slice(0, 500) : null;
        db.prepare(`UPDATE notification_outbox SET status=?,error=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND business_id=?`).run(status, error, existing.id, settings.business_id);
        updated++;
      }
    }
  }
  return updated;
}
