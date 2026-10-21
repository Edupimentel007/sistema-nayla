import { createHash, timingSafeEqual } from 'node:crypto';

type ReminderSweep = (now?: Date) => Promise<{ queued: number; processed: number }>;

export type ReminderCronRequest = {
  method: string;
  authorization?: string;
};

export type ReminderCronResult = {
  status: number;
  body: { ok: boolean; queued?: number; processed?: number; error?: string };
};

function authorized(header: string | undefined, secret: string) {
  if (!header?.startsWith('Bearer ') || header.length > 4096) return false;
  const provided = header.slice('Bearer '.length);
  if (!provided || provided.trim() !== provided) return false;
  // Hash first so comparison time does not depend on the token's length.
  const expectedHash = createHash('sha256').update(secret).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

// Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET>.
// Keep this adapter independent of Express so the persistent API and a future
// Vercel Function can use the same fail-closed entry point.
export async function handleReminderCron(request: ReminderCronRequest,
  sweep?: ReminderSweep): Promise<ReminderCronResult> {
  if (request.method !== 'GET')
    return { status: 405, body: { ok: false, error: 'Método não permitido.' } };

  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return { status: 503, body: { ok: false, error: 'Agendamento indisponível.' } };
  if (!authorized(request.authorization, secret))
    return { status: 401, body: { ok: false, error: 'Não autorizado.' } };

  try {
    const runSweep = sweep ?? (await import('./inbox.js')).processDueReminders;
    const { queued, processed } = await runSweep();
    return { status: 200, body: { ok: true, queued, processed } };
  } catch (error) {
    console.error('Falha no processamento agendado de lembretes',
      error instanceof Error ? error.constructor.name : 'UnknownError');
    return { status: 500, body: { ok: false, error: 'Falha ao processar lembretes.' } };
  }
}
