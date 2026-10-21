import { db, localNow } from './db.js';

// Bound this setting to keep one tenant from exhausting the shared free tier.
export function hostedAssistantDailyLimit() {
  const configured = process.env.NAYLA_GROQ_DAILY_LIMIT;
  if (!configured || !/^\d{1,3}$/.test(configured)) return 20;
  return Math.max(1, Math.min(100, Number(configured)));
}

export function hostedAssistantGlobalDailyLimit() {
  const configured = process.env.NAYLA_GROQ_GLOBAL_DAILY_LIMIT;
  if (!configured || !/^\d{1,3}$/.test(configured)) return 700;
  return Math.max(1, Math.min(900, Number(configured)));
}

type Reservation = { businessId: string; businessDay: string; globalDayUtc: string };
const globalLimitReached = Symbol('global limit reached');

// Both limits are in one SQLite write transaction, so concurrent requests
// cannot each claim the final slot. Our global cap uses UTC calendar days;
// the provider may reset its own limits at a different time.
export function reserveHostedAssistantCall(businessId: string,
  businessDay = localNow().date, globalDayUtc = new Date().toISOString().slice(0, 10))
  : Reservation | null {
  try {
    return db.transaction(() => {
      const business = db.prepare(`INSERT INTO assistant_ai_daily_usage(business_id,day,calls)
        VALUES(?,?,1) ON CONFLICT(business_id,day) DO UPDATE SET calls=calls+1
        WHERE calls<?`).run(businessId, businessDay, hostedAssistantDailyLimit());
      if (!business.changes) return null;
      const global = db.prepare(`INSERT INTO assistant_ai_global_usage(day_utc,calls)
        VALUES(?,1) ON CONFLICT(day_utc) DO UPDATE SET calls=calls+1
        WHERE calls<?`).run(globalDayUtc, hostedAssistantGlobalDailyLimit());
      if (!global.changes) throw globalLimitReached;
      return { businessId, businessDay, globalDayUtc };
    }).immediate();
  } catch (error) {
    if (error === globalLimitReached) return null;
    throw error;
  }
}

export function releaseHostedAssistantCall(reservation: Reservation) {
  db.transaction(() => {
    db.prepare(`UPDATE assistant_ai_daily_usage SET calls=calls-1
      WHERE business_id=? AND day=? AND calls>0`)
      .run(reservation.businessId, reservation.businessDay);
    db.prepare(`UPDATE assistant_ai_global_usage SET calls=calls-1
      WHERE day_utc=? AND calls>0`).run(reservation.globalDayUtc);
  }).immediate();
}
