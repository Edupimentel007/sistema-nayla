import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { catalog } from './catalog.js';

let child: ChildProcessWithoutNullStreams;
let directory: string;
let origin: string;
let output = '';
const identitySecret = Buffer.alloc(32, 19).toString('base64');

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}
async function request(path: string, method = 'GET', body?: unknown, cookies = '') {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(cookies ? {Cookie:cookies} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
  return {status:response.status, body: await response.json() as any,
    cookies: setCookies.join('; ')};
}
let sequence = 0;
async function register(phone?: string, cookies = '') {
  const n = ++sequence;
  const result = await request('/api/auth/register','POST',{
    ownerName: `Profissional ${n}`, businessName: `Espaço ${n}`,
    slug:`espaco-manual-${n}`, email:`owner-manual-${n}@example.test`,
    password:'SenhaMuitoForte123', phone:phone || `1198888${String(n).padStart(4,'0')}`,
    specialties:['unhas'],selectedServices:catalog.filter(item => item.category === 'unhas')
      .map(item => item.id),
  },cookies);
  assert.equal(result.status,201,JSON.stringify(result.body));
  return result;
}
function database() { return new Database(join(directory,'nayla.sqlite')); }

describe('manual access and superadmin', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(),'nayla-manual-access-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath,['--import','tsx','server/index.ts'],{
      cwd:resolve('.'),env:{...process.env,PORT:String(port),DATABASE_PATH:join(directory,'nayla.sqlite'),
        NODE_ENV:'test',APP_ORIGIN:origin,ACCESS_IDENTITY_SECRET:identitySecret,
        OLLAMA_BASE_URL:'http://127.0.0.1:1/v1',WHATSAPP_MODE:'simulate'},
    });
    child.stdout.on('data',chunk => {output += String(chunk);});
    child.stderr.on('data',chunk => {output += String(chunk);});
    for (let attempt=0;attempt<100;attempt++) {
      try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* starting */ }
      if (child.exitCode !== null) break;
      await new Promise(done => setTimeout(done,100));
    }
    throw new Error(`API failed: ${output}`);
  },{timeout:20_000});
  after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise<void>(done => child.once('exit',()=>done())),
        new Promise(done => setTimeout(done,3000))]);
    }
    if (directory?.startsWith(join(tmpdir(),'nayla-manual-access-')))
      rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:200});
  });

  it('requires owner contact and manual approval; only a local promotion authorizes admin', async () => {
    const invalid = await request('/api/auth/register','POST',{
      ownerName:'Sem telefone',businessName:'Sem telefone',slug:'sem-telefone',
      email:'sem-telefone@example.test',password:'SenhaMuitoForte123',
      specialties:['unhas'],selectedServices:[catalog.find(item => item.category==='unhas')!.id],
    });
    assert.equal(invalid.status,400);
    const admin = await register();
    const professional = await register();
    assert.equal((await request('/api/billing/subscription','GET',undefined,professional.cookies))
      .body.manualAccessStatus,'pending');
    assert.equal((await request('/api/finance','GET',undefined,professional.cookies)).status,402);
    assert.equal((await request('/api/admin/me','GET',undefined,professional.cookies)).body.isSuperAdmin,false);
    assert.equal((await request('/api/admin/professionals','GET',undefined,professional.cookies)).status,403);
    const local = database();
    try { local.prepare('INSERT INTO super_admin_accounts(user_id) VALUES(?)').run(admin.body.user.id); }
    finally {local.close();}
    assert.equal((await request('/api/admin/me','GET',undefined,admin.cookies)).body.isSuperAdmin,true);
    const listed = await request('/api/admin/professionals?query=owner-manual&pageSize=1',
      'GET',undefined,admin.cookies);
    assert.equal(listed.status,200);
    assert.equal(listed.body.total,2);
    assert.equal(listed.body.items.length,1);
    assert.ok(listed.body.items[0].phone);
    assert.equal((await request('/api/billing/trial','POST',{},professional.cookies)).status,404);
    assert.equal((await request('/api/billing/checkout','POST',{},professional.cookies)).status,404);
    const businessId = professional.body.business.id;
    const grant = await request(`/api/admin/professionals/${businessId}/grant`,'POST',{},admin.cookies);
    assert.equal(grant.status,200,JSON.stringify(grant.body));
    assert.equal(grant.body.manualAccessStatus,'trial');
    assert.equal((await request(`/api/admin/professionals/${businessId}/grant`,'POST',
      {kind:'trial'},admin.cookies)).status,409);
    assert.equal((await request('/api/finance','GET',undefined,professional.cookies)).status,200);
    const publicPage = await request(`/api/public/${professional.body.business.slug}`);
    const serviceId = publicPage.body.services[0].id;
    const day = new Date();
    day.setUTCDate(day.getUTCDate()+4);
    while (day.getUTCDay()===0) day.setUTCDate(day.getUTCDate()+1);
    const date = day.toISOString().slice(0,10);
    const slots = await request(`/api/public/${professional.body.business.slug}/availability?serviceId=${serviceId}&date=${date}`);
    assert.ok(slots.body.slots.length>0);
    const booked = await request(`/api/public/${professional.body.business.slug}/bookings`,'POST',{
      serviceId,date,time:slots.body.slots[0],client:{name:'Cliente de teste',cpf:'52998224725',
        phone:'11999998888',password:'SenhaClienteForte123',whatsappOptIn:false},
    });
    assert.equal(booked.status,201,JSON.stringify(booked.body));
    const revoked = await request(`/api/admin/professionals/${businessId}/revoke`,'POST',
      {reason:'Cobrança manual'},admin.cookies);
    assert.equal(revoked.body.manualAccessStatus,'blocked');
    assert.equal((await request('/api/finance','GET',undefined,professional.cookies)).status,402);
    assert.equal((await request(`/api/public/${professional.body.business.slug}/availability?serviceId=${serviceId}&date=${date}`)).body.slots.length,0);
    assert.equal((await request(`/api/client/appointments/${booked.body.appointment.id}`,'PATCH',
      {date,time:slots.body.slots[1]},booked.cookies)).status,503);
    const cancelled = await request(`/api/client/appointments/${booked.body.appointment.id}/cancel`,
      'PATCH',{reason:'Não haverá atendimento'},booked.cookies);
    assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status,'cancelled');
    assert.equal(cancelled.body.notificationStatus,null);
    assert.equal((await request(`/api/public/${professional.body.business.slug}/bookings`,
      'POST',{},professional.cookies)).status,503);
    const paid = await request(`/api/admin/professionals/${businessId}/grant`,'POST',
      {days:30},admin.cookies);
    assert.equal(paid.body.manualAccessStatus,'active');
    const previousEnd = Date.parse(paid.body.accessEndsAt);
    assert.equal((await request(`/api/admin/professionals/${businessId}/grant`,'POST',
      {kind:'paid',days:1},admin.cookies)).status,409);
    const extended = await request(`/api/admin/professionals/${businessId}/extend`,'POST',
      {days:15},admin.cookies);
    assert.equal(extended.body.manualAccessStatus,'active');
    assert.ok(Date.parse(extended.body.accessEndsAt)>previousEnd);
    const audit = await request(`/api/admin/audit?businessId=${businessId}`,'GET',undefined,admin.cookies);
    assert.equal(audit.body.items.length,4);
    assert.deepEqual(audit.body.items.map((item:any)=>item.action),
      ['access_extended','access_granted','access_blocked','trial_granted']);
  });

  it('denies repeat trials across another account and an observed browser install', async () => {
    const admin = await request('/api/auth/login','POST',
      {email:'owner-manual-1@example.test',password:'SenhaMuitoForte123'});
    const first = await register('11977770001');
    const firstGrant = await request(`/api/admin/professionals/${first.body.business.id}/grant`,
      'POST',{},admin.cookies);
    assert.equal(firstGrant.status,200,JSON.stringify(firstGrant.body));
    const samePhone = await register('11977770001');
    const duplicatePhone = await request(`/api/admin/professionals/${samePhone.body.business.id}/grant`,
      'POST',{},admin.cookies);
    assert.equal(duplicatePhone.status,409);
    const device = first.cookies.split('; ').find(item=>item.startsWith('nayla_trial_device='));
    assert.ok(device);
    const sameInstall = await register('11977770002',device);
    const duplicateInstall = await request(`/api/admin/professionals/${sameInstall.body.business.id}/grant`,
      'POST',{},admin.cookies);
    assert.equal(duplicateInstall.status,409);
    const local = database();
    try {
      local.prepare("UPDATE sessions SET created_at='2020-01-01 00:00:00' WHERE user_id=?")
        .run(admin.body.user.id);
    } finally {local.close();}
    const tooOld = await request(`/api/admin/professionals/${sameInstall.body.business.id}/grant`,
      'POST',{kind:'paid'},admin.cookies);
    assert.equal(tooOld.status,403);
    assert.match(tooOld.body.error,/Entre novamente/);
  });
});
