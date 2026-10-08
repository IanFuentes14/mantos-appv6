import { createClient } from 'jsr:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const respond = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,'Content-Type':'application/json'}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = ['operacionales','seguridad','equipos','administrativos'];
const maxPdfBytes = 50 * 1024 * 1024;
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return respond({error:'Método no permitido.'},405);
  const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key) return respond({error:'Servidor no configurado.'},500);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token) return respond({error:'Sesión administrativa requerida.'},401);
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user?.email||auth.user.is_anonymous) return respond({error:'Ingrese con su cuenta administrativa.'},401);
  const email=auth.user.email.toLowerCase();
  const allowed=(Deno.env.get('ADMIN_EMAILS')||'admin@mantos.app').split(',').map(v=>v.trim().toLowerCase());
  if(!allowed.includes(email)) return respond({error:'Su cuenta no está autorizada para publicar procedimientos.'},403);
  try {
    const body=await req.json();
    if(body.action==='authorize') return respond({ok:true,email});
    if(body.action==='retire') {
      if(!uuid.test(body.id)||!Number.isInteger(body.version)) return respond({error:'Documento inválido.'},400);
      const {data,error}=await db.from('procedures').update({is_active:false,version:body.version+1,updated_at:new Date().toISOString(),updated_by:email}).eq('id',body.id).eq('version',body.version).select().maybeSingle();
      if(error) throw error;
      if(!data) return respond({error:'El documento cambió. Actualice el catálogo.'},409);
      return respond({ok:true,document:data});
    }
    if(!uuid.test(body.upload_id)) return respond({error:'Identificador de carga inválido.'},400);
    let {data:ticket,error:ticketError}=await db.from('procedure_uploads').select('*').eq('id',body.upload_id).maybeSingle();
    if(ticketError) throw ticketError;
    if(ticket && ticket.owner_email!==email) return respond({error:'Carga no autorizada.'},403);
    if(body.action==='prepare') {
      if(!ticket) {
        const m=body.metadata;
        if(!m||!uuid.test(body.procedure_id)||!Number.isInteger(body.expected_version)||body.expected_version<0||!categories.includes(m.category)||typeof m.title!=='string'||!m.title.trim()||m.title.length>180||typeof m.description!=='string'||m.description.length>2000||typeof m.filename!=='string'||m.filename.length>180||!m.filename.toLowerCase().endsWith('.pdf')||!Number.isInteger(m.size_bytes)||m.size_bytes<1||m.size_bytes>maxPdfBytes||!/^[0-9a-f]{64}$/.test(m.sha256)) return respond({error:'Metadatos o PDF inválidos (máximo 50 MB).'},400);
        const result=await db.from('procedure_uploads').upsert({id:body.upload_id,procedure_id:body.procedure_id,expected_version:body.expected_version,owner_email:email,metadata:{...m,title:m.title.trim()},storage_path:`${body.procedure_id}/${body.upload_id}.pdf`},{onConflict:'id',ignoreDuplicates:true});
        if(result.error) throw result.error;
        const reread=await db.from('procedure_uploads').select('*').eq('id',body.upload_id).single();
        if(reread.error) throw reread.error;
        ticket=reread.data;
        if(ticket.owner_email!==email) return respond({error:'Carga no autorizada.'},403);
      }
      if(ticket.completed_result) return respond({ok:true,document:ticket.completed_result,completed:true});
      const signed=await db.storage.from('procedure-pdfs').createSignedUploadUrl(ticket.storage_path);
      if(signed.error) throw signed.error;
      return respond({ok:true,path:ticket.storage_path,token:signed.data.token});
    }
    if(body.action==='finalize' && ticket) {
      if(ticket.completed_result) return respond({ok:true,document:ticket.completed_result});
      const file=await db.storage.from('procedure-pdfs').download(ticket.storage_path);
      if(file.error||!file.data) return respond({error:'El PDF todavía no está cargado.',code:'missing_file'},404);
      const bytes=await file.data.arrayBuffer();
      if(bytes.byteLength!==ticket.metadata.size_bytes||bytes.byteLength>maxPdfBytes||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-') return respond({error:'El archivo cargado no es el PDF esperado (máximo 50 MB).'},400);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==ticket.metadata.sha256) return respond({error:'La integridad del PDF no coincide.'},400);
      const result=await db.rpc('finalize_procedure_upload',{upload_id:ticket.id,admin_email:email});
      if(result.error) return respond({error:result.error.message},409);
      return respond({ok:true,document:result.data});
    }
    return respond({error:'Acción inválida.'},400);
  } catch(error) { return respond({error:error instanceof Error?error.message:String((error as {message?:string})?.message||'Error de publicación.')},500); }
});
