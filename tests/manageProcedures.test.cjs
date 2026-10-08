const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { transformSync } = require('../node_modules/esbuild');
const source = fs.readFileSync('supabase/functions/manage-procedures/index.ts', 'utf8').replace(/^import .*\n/, 'const createClient = () => globalThis.mockDb;\n');
const code = transformSync(source, { loader: 'ts', target: 'es2022' }).code;
const uploadId = '00000000-0000-4000-8000-000000000010';
const procedureId = '00000000-0000-4000-8000-000000000011';
function endpoint({ email='admin@mantos.app', anonymous=false, file=null, ticket=null, valid=true }={}) {
  const calls = { writes:0, confirmations:0 };
  const db = { auth:{getUser:async token => ({data:{user:valid&&token?{email,is_anonymous:anonymous}:null},error:valid?null:new Error('Invalid token')})},
    from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:ticket,error:null})}),
    storage:{from:()=>({download:async()=>file?{data:file,error:null}:{data:null,error:new Error('Missing')},createSignedUploadUrl:async()=>({data:{token:'upload'},error:null})})},
    rpc:async()=>{calls.confirmations++;return {data:{id:procedureId,version:1},error:null};},
  };
  let handler;
  vm.runInNewContext(code,{mockDb:db,Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'server-only':undefined},serve:fn=>handler=fn},Response,TextDecoder,Uint8Array,crypto:crypto.webcrypto,console});
  return { calls, invoke:async (body,token='valid') => handler(new Request('https://example.test/',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})) };
}
test('anonymous, non-allowlisted and unauthenticated accounts cannot manage documents',async()=>{
  for(const [options,expected] of [[{anonymous:true},401],[{email:'operator@example.test'},403],[{valid:false},401]]){
    const app=endpoint(options);
    for(const action of ['authorize','prepare','finalize','retire'])assert.equal((await app.invoke({action,upload_id:uploadId,id:procedureId,version:1})).status,expected);
    assert.equal(app.calls.confirmations,0);
  }
});
test('allowlisted account can authorize but invalid upload metadata is rejected',async()=>{
  const app=endpoint();assert.equal((await app.invoke({action:'authorize'})).status,200);
  assert.equal((await app.invoke({action:'prepare',upload_id:uploadId,procedure_id:procedureId,expected_version:0,metadata:{title:'x'}})).status,400);
});
test('publication cannot confirm a missing or altered PDF',async()=>{
  const ticket={id:uploadId,procedure_id:procedureId,owner_email:'admin@mantos.app',storage_path:'one.pdf',metadata:{size_bytes:12,sha256:'0'.repeat(64)}};
  const missing=endpoint({ticket});const response=await missing.invoke({action:'finalize',upload_id:uploadId});assert.equal(response.status,404);assert.equal((await response.json()).code,'missing_file');
  const invalid=endpoint({ticket,file:new Blob(['%PDF-changed'])});assert.equal((await invalid.invoke({action:'finalize',upload_id:uploadId})).status,400);assert.equal(invalid.calls.confirmations,0);
});
test('verified PDF is confirmed and completed retries never increment a version again',async()=>{
  const bytes=Buffer.from('%PDF-1.4\nValid test\n%%EOF');
  const ticket={id:uploadId,owner_email:'admin@mantos.app',storage_path:'test.pdf',metadata:{size_bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
  const app=endpoint({ticket,file:new Blob([bytes])});assert.equal((await app.invoke({action:'finalize',upload_id:uploadId})).status,200);assert.equal(app.calls.confirmations,1);
  const retry=endpoint({ticket:{...ticket,completed_result:{id:procedureId,version:1}}});assert.equal((await retry.invoke({action:'finalize',upload_id:uploadId})).status,200);assert.equal(retry.calls.confirmations,0);
});
test('even another allowlisted identity cannot confirm another administrators upload',async()=>{
  const app=endpoint({ticket:{id:uploadId,owner_email:'other@mantos.app'}});assert.equal((await app.invoke({action:'finalize',upload_id:uploadId})).status,403);
});
