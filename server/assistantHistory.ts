import { db, id } from './db.js';

type OwnerScope = { businessId: string; userId: string };
type Row = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  role?: 'user' | 'assistant';
  text?: string;
  message_count?: number;
  preview?: string | null;
};

export class AssistantConversationNotFound extends Error {
  constructor() { super('Conversa não encontrada.'); }
}

export class AssistantActionConflict extends Error {
  constructor() { super('Esta alteração já foi registrada em outra conversa.'); }
}

function conversationDto(row: Row) {
  return {
    id: row.id, title: row.title,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function scopedConversation(scope: OwnerScope, conversationId: string) {
  return db.prepare(`SELECT id,title,created_at,updated_at FROM assistant_conversations
    WHERE id=? AND business_id=? AND owner_user_id=?`)
    .get(conversationId, scope.businessId, scope.userId) as Row | undefined;
}

export function listAssistantConversations(scope: OwnerScope, limit = 100, offset = 0) {
  const rows = db.prepare(`SELECT c.id,c.title,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.conversation_id=c.id) AS message_count,
      (SELECT text FROM assistant_messages m WHERE m.conversation_id=c.id
        ORDER BY m.rowid DESC LIMIT 1) AS preview
    FROM assistant_conversations c WHERE c.business_id=? AND c.owner_user_id=?
    ORDER BY c.updated_at DESC,c.rowid DESC LIMIT ? OFFSET ?`)
    .all(scope.businessId, scope.userId, limit, offset) as Row[];
  return { conversations: rows.map(row => ({
    ...conversationDto(row), messageCount: row.message_count || 0,
    preview: (row.preview || '').slice(0, 160),
  })) };
}

export function getAssistantConversation(scope: OwnerScope, conversationId: string) {
  const conversation = scopedConversation(scope, conversationId);
  if (!conversation) return null;
  const rows = db.prepare(`SELECT id,role,text,created_at FROM assistant_messages
    WHERE conversation_id=? ORDER BY rowid ASC`).all(conversationId) as Row[];
  return {
    conversation: conversationDto(conversation),
    messages: rows.map(row => ({ id: row.id, role: row.role!, text: row.text!,
      createdAt: row.created_at })),
  };
}

export function assistantConversationHistory(scope: OwnerScope, conversationId: string) {
  if (!scopedConversation(scope, conversationId)) throw new AssistantConversationNotFound();
  const rows = db.prepare(`SELECT role,text FROM assistant_messages
    WHERE conversation_id=? ORDER BY rowid DESC LIMIT 8`).all(conversationId) as Row[];
  return rows.reverse().map(row => ({ role: row.role!, text: row.text! }));
}

export function saveAssistantExchange(scope: OwnerScope, conversationId: string | undefined,
  question: string, answer: string) {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const targetId = conversationId || id();
    if (conversationId) {
      const updated = db.prepare(`UPDATE assistant_conversations SET updated_at=?
        WHERE id=? AND business_id=? AND owner_user_id=?`)
        .run(now, targetId, scope.businessId, scope.userId);
      if (!updated.changes) throw new AssistantConversationNotFound();
    } else {
      const title = Array.from(question.replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
      db.prepare(`INSERT INTO assistant_conversations
        (id,business_id,owner_user_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
        .run(targetId, scope.businessId, scope.userId, title, now, now);
    }
    const userMessageId = id();
    const assistantMessageId = id();
    const insert = db.prepare(`INSERT INTO assistant_messages
      (id,conversation_id,role,text,created_at) VALUES(?,?,?,?,?)`);
    insert.run(userMessageId, targetId, 'user', question, now);
    insert.run(assistantMessageId, targetId, 'assistant', answer, now);
    return { conversationId: targetId, userMessageId, assistantMessageId };
  }).immediate();
}

function actionNotificationText(status: string | undefined) {
  switch (status) {
    case 'accepted': case 'sent': return 'O WhatsApp aceitou o aviso; a entrega ainda não foi confirmada.';
    case 'delivered': return 'O aviso foi entregue pelo WhatsApp.';
    case 'read': return 'O aviso foi lido no WhatsApp.';
    case 'simulated': return 'O aviso foi registrado em modo de simulação. Nenhuma mensagem foi enviada.';
    case 'opted_out': return 'A cliente não autorizou mensagens automáticas. Nenhuma mensagem foi enviada.';
    case 'not_configured': return 'O WhatsApp ainda não está configurado para envio real. Nenhuma mensagem foi enviada.';
    case 'failed': return 'O envio automático falhou. Confira o histórico em Configurações.';
    case 'pending': return 'O aviso está em processamento. Confira o histórico em Configurações.';
    default: return 'Confira o histórico de avisos em Configurações.';
  }
}

export function saveAssistantActionResult(scope: OwnerScope, conversationId: string, eventId: string) {
  return db.transaction(() => {
    if (!scopedConversation(scope, conversationId)) throw new AssistantConversationNotFound();
    const existing = db.prepare(`SELECT r.conversation_id,m.id,m.text
      FROM assistant_action_results r JOIN assistant_messages m ON m.id=r.message_id
      JOIN appointment_events e ON e.id=r.event_id
      WHERE r.event_id=? AND e.business_id=?`)
      .get(eventId, scope.businessId) as { conversation_id: string; id: string; text: string } | undefined;
    if (existing) {
      if (existing.conversation_id !== conversationId) throw new AssistantActionConflict();
      return { answer: existing.text, assistantMessageId: existing.id };
    }
    const event = db.prepare(`SELECT e.kind,e.previous_date,e.previous_time,a.id AS appointment_id,
        u.name AS client_name,COALESCE(previous_service.name,current_service.name) AS service_name
      FROM appointment_events e JOIN appointments a ON a.id=e.appointment_id
      JOIN users u ON u.id=a.client_id
      JOIN services current_service ON current_service.id=a.service_id
      LEFT JOIN services previous_service ON previous_service.id=e.previous_service_id
      WHERE e.id=? AND e.business_id=? AND a.business_id=? AND e.actor='owner'
        AND e.kind IN ('reschedule_requested','cancelled')`)
      .get(eventId, scope.businessId, scope.businessId) as {
        kind: 'reschedule_requested' | 'cancelled'; previous_date: string;
        previous_time: string; appointment_id: string; client_name: string; service_name: string;
      } | undefined;
    if (!event) throw new AssistantConversationNotFound();
    const notificationKind = event.kind === 'reschedule_requested'
      ? 'owner_reschedule_request' : 'owner_cancelled';
    const notification = db.prepare(`SELECT status FROM notification_outbox
      WHERE business_id=? AND appointment_id=? AND kind=? ORDER BY rowid DESC LIMIT 1`)
      .get(scope.businessId, event.appointment_id, notificationKind) as { status: string } | undefined;
    const displayDate = event.previous_date.split('-').reverse().join('/');
    const action = event.kind === 'reschedule_requested'
      ? 'Pedido de remarcação registrado' : 'Agendamento cancelado';
    const answer = `${action} para ${event.client_name} (${event.service_name}, ${displayDate} às ${event.previous_time}). O horário antigo foi liberado. ${actionNotificationText(notification?.status)}`;
    const now = new Date().toISOString();
    const assistantMessageId = id();
    db.prepare(`INSERT INTO assistant_messages
      (id,conversation_id,role,text,created_at) VALUES(?,?,'assistant',?,?)`)
      .run(assistantMessageId, conversationId, answer, now);
    db.prepare(`INSERT INTO assistant_action_results(event_id,conversation_id,message_id)
      VALUES(?,?,?)`).run(eventId, conversationId, assistantMessageId);
    db.prepare(`UPDATE assistant_conversations SET updated_at=?
      WHERE id=? AND business_id=? AND owner_user_id=?`)
      .run(now, conversationId, scope.businessId, scope.userId);
    return { answer, assistantMessageId };
  }).immediate();
}

export function deleteAssistantConversation(scope: OwnerScope, conversationId: string) {
  return db.prepare(`DELETE FROM assistant_conversations
    WHERE id=? AND business_id=? AND owner_user_id=?`)
    .run(conversationId, scope.businessId, scope.userId).changes > 0;
}
