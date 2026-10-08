import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
function readEnv(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(fs.readFileSync(path, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line))
    .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
}
const env = { ...readEnv('.env'), ...readEnv('.env.admin'), ...process.env };
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
const password = env.NEW_ADMIN_PASSWORD;
if (!secret || !password) throw new Error('Configure SUPABASE_SERVICE_ROLE_KEY y NEW_ADMIN_PASSWORD en .env.admin (archivo privado).');
if (new URL(env.VITE_SUPABASE_URL).hostname !== 'hvrpsssdhlrumxqaeixq.supabase.co') throw new Error('Proyecto Supabase inesperado.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.VITE_SUPABASE_URL, secret, options);
const email = 'admin@mantos.app';
let target;
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error('No se pudo consultar usuarios: ' + error.message);
  target = data.users.find(user => user.email?.toLowerCase() === email && !user.is_anonymous);
  if (target || data.users.length < 100) break;
}
if (!target) throw new Error('No se encontró la cuenta ' + email + '. No se ha creado ni modificado ningún usuario.');
const { error } = await admin.auth.admin.updateUserById(target.id, { password });
if (error) throw new Error('No se pudo cambiar la contraseña: ' + error.message);
const verifier = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const result = await verifier.auth.signInWithPassword({ email, password });
if (result.error) throw new Error('Contraseña actualizada, pero falló la verificación: ' + result.error.message);
await verifier.auth.signOut({ scope: 'local' });
console.log('Contraseña actualizada y acceso verificado para ' + email);
