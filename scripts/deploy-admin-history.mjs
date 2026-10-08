import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readEnv(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(fs.readFileSync(filename,'utf8').split(/\r?\n/).filter(line=>line.trim()&&!line.trim().startsWith('#')&&line.includes('=')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
}
const env = {...readEnv(path.join(root,'.env')),...readEnv(path.join(root,'.env.deploy'))};
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Falta el token privado de despliegue.');
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Referencia de proyecto inválida.');
async function request(endpoint, body) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/${endpoint}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${(await response.text()).replaceAll(token,'[REDACTADO]').slice(0,1200)}`);
  return response.json();
}
await request('functions');
const form=new FormData();
form.append('metadata',JSON.stringify({name:'delete-local-record',entrypoint_path:'index.ts',verify_jwt:false}));
form.append('file',new Blob([fs.readFileSync(path.join(root,'supabase/functions/delete-local-record/index.ts'),'utf8')],{type:'application/typescript'}),'index.ts');
await request('functions/deploy?slug=delete-local-record',form);
const deployed=await request('functions/delete-local-record');
if(deployed.status!=='ACTIVE')throw new Error('La función no aparece activa.');
console.log('Función de borrado administrativo activa. No se ejecutó ningún borrado de registros.');
