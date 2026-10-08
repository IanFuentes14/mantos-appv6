import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureOperatorSession, getAdminSession, migrateOperatorSession } from '../src/lib/authSession.js';

const adminSession = { user: { email: 'admin@mantos.app', is_anonymous: false } };
const operatorSession = { user: { is_anonymous: true } };
function client(session) {
  return { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInAnonymously: async () => ({ data: { session: operatorSession }, error: null }),
    signOut: () => { throw new Error('Must not invalidate existing refresh tokens'); },
  } };
}
test('operator synchronization leaves administrator session usable after renewal', async () => {
  const admin = client(adminSession);
  const operator = client(null);
  await ensureOperatorSession(operator);
  assert.equal(await getAdminSession(admin), adminSession);
  await ensureOperatorSession(operator);
  assert.equal(await getAdminSession(admin), adminSession);
});
test('operator reuses its existing anonymous identity', async () => {
  const operator = client(operatorSession);
  operator.auth.signInAnonymously = () => { throw new Error('Identity should be preserved'); };
  assert.equal(await ensureOperatorSession(operator), operatorSession);
});
test('operator refuses to replace administrator credentials', async () => {
  await assert.rejects(ensureOperatorSession(client(adminSession)), /separada/);
});
test('administrator rejects anonymous and expired sessions', async () => {
  await assert.rejects(getAdminSession(client(operatorSession)), /Vuelva a ingresar/);
  await assert.rejects(getAdminSession(client(null)), /Vuelva a ingresar/);
});
test('session errors are preserved instead of silently creating another identity', async () => {
  const error = new Error('Network unavailable');
  const broken = { auth: { getSession: async () => ({ data: {}, error }) } };
  await assert.rejects(ensureOperatorSession(broken), error);
  await assert.rejects(getAdminSession(broken), error);
});
function storage(entries) {
  const values = new Map(entries);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('migration preserves operator ownership and removes duplicated refresh tokens', () => {
  const raw = JSON.stringify(operatorSession);
  const saved = storage([['old', raw]]);
  migrateOperatorSession(saved, 'old', 'operator');
  assert.equal(saved.getItem('operator'), raw);
  assert.equal(saved.getItem('old'), null);
});
test('migration never moves the administrator or overwrites existing operator data', () => {
  const raw = JSON.stringify(adminSession);
  const saved = storage([['old', raw]]);
  migrateOperatorSession(saved, 'old', 'operator');
  assert.equal(saved.getItem('old'), raw);
  assert.equal(saved.getItem('operator'), null);
  saved.setItem('operator', 'existing');
  migrateOperatorSession(saved, 'old', 'operator');
  assert.equal(saved.getItem('operator'), 'existing');
});
