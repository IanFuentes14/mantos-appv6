import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readEnv(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('=')).map(line => {
    const i = line.indexOf('='); return [line.slice(0,i).trim(), line.slice(i+1).trim().replace(/^['"]|['"]$/g, '')];
  }));
}
const env = { ...readEnv(path.join(root,'.env')), ...readEnv(path.join(root,'.env.deploy')) };
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Falta SUPABASE_ACCESS_TOKEN en el archivo privado .env.deploy. No use una contraseña de la app ni la clave pública.');
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Referencia de proyecto no válida.');
async function request(endpoint, body, type='application/json') {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${endpoint}`, { method:body?'POST':'GET', headers:{Authorization:`Bearer ${token}`, ...(type?{'Content-Type':type}:{})}, body, signal:AbortSignal.timeout(120000) });
  if (!response.ok) {
    const detail = (await response.text()).replaceAll(token, '[REDACTADO]').slice(0, 1600);
    throw new Error(`Supabase rechazó ${endpoint.split('?')[0]} (HTTP ${response.status}): ${detail}`);
  }
  return response.json();
}
console.log(`Activando procedimientos en el proyecto ${ref}…`);
// Check access before changing the project.
await request('functions');
for (const filename of ['202610080001_procedures.sql','202610080002_procedure_pdf_50mb.sql']) {
  const migration=fs.readFileSync(path.join(root,'supabase/migrations',filename),'utf8');
  await request('database/query',JSON.stringify({query:migration,read_only:false}));
}
console.log('Catálogo, límite de 50 MB, permisos y almacenamiento configurados.');
const source=fs.readFileSync(path.join(root,'supabase/functions/manage-procedures/index.ts'),'utf8');
const form=new FormData();
form.append('metadata',JSON.stringify({name:'manage-procedures',entrypoint_path:'index.ts',verify_jwt:false}));
form.append('file',new Blob([source],{type:'application/typescript'}),'index.ts');
await request('functions/deploy?slug=manage-procedures',form,null);
const deployed=await request('functions/manage-procedures');
if (deployed.status !== 'ACTIVE') throw new Error('La función todavía no aparece activa. Revise su despliegue en Supabase.');
console.log('manage-procedures activa. La función valida la sesión y ADMIN_EMAILS en el servidor.');
