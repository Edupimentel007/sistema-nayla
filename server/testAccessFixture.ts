import Database from 'better-sqlite3';
import { join } from 'node:path';

// Integration tests for unrelated features provision a paid fixture owner
// directly in their isolated database. Production registration remains pending.
export function activateFixtureOwner(directory: string, businessId: string) {
  const database = new Database(join(directory,'nayla.sqlite'));
  try {
    database.prepare(`INSERT INTO business_access(business_id,state,access_ends_at)
      VALUES(?,'active',?) ON CONFLICT(business_id) DO UPDATE SET
      state='active',access_ends_at=excluded.access_ends_at`)
      .run(businessId,Date.now()+365*86_400_000);
  } finally {database.close();}
}

export function fixtureOwnerPhone(path: string, body: BodyInit | null | undefined) {
  if (typeof body !== 'string' ||
    path !== '/api/auth/register' && path !== '/api/auth/google/register') return body;
  try {
    const input = JSON.parse(body) as Record<string,unknown>;
    if (path === '/api/auth/google/register' && input.role !== 'owner') return body;
    if (!input.phone) input.phone = '11999999999';
    return JSON.stringify(input);
  } catch {return body;}
}
