import { db, id } from './db.js';

type Confirmation = {
  businessId: string;
  appointmentId: string;
  recipient: string;
  clientName: string;
  serviceName: string;
  date: string;
  time: string;
};

export async function sendBookingConfirmation(details: Confirmation) {
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${details.date}T12:00:00Z`));
  const formattedDate = details.date.split('-').reverse().join('/');
  const message = `Olá, ${details.clientName}! Seu atendimento de ${details.serviceName} está confirmado para ${weekday}, ${formattedDate}, às ${details.time}. Até lá!`;
  const recipient = details.recipient.replace(/\D/g, '').replace(/^(?=\d{10,11}$)/, '55');
  const notificationId = id();
  const configured = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
  db.prepare(`INSERT INTO notification_outbox
    (id,business_id,appointment_id,recipient,message,status)
    VALUES (?,?,?,?,?,?)`).run(notificationId, details.businessId, details.appointmentId, recipient, message, configured ? 'pending' : 'not_configured');
  if (!configured) return 'not_configured';

  try {
    const response = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [
            details.clientName, details.serviceName, weekday, formattedDate, details.time,
          ].map(text => ({ type: 'text', text })) }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json() as { messages?: { id: string }[]; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message || `Meta HTTP ${response.status}`);
    db.prepare(`UPDATE notification_outbox SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(result.messages?.[0]?.id || null, notificationId);
    return 'sent';
  } catch (error) {
    db.prepare(`UPDATE notification_outbox SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(String(error).slice(0, 500), notificationId);
    return 'failed';
  }
}
