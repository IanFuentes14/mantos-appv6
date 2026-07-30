import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DOCUMENT_BUCKET = 'conduction-documents';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAllowedAdminEmails() {
  return (Deno.env.get('ADMIN_EMAILS') || 'admin@mantos.app')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function assertAdminRequest(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, error: 'Sesion administrativa requerida.' };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return { ok: false, error: 'Sesion administrativa invalida.' };

  const email = data.user.email.toLowerCase();
  if (!getAllowedAdminEmails().includes(email)) {
    return { ok: false, error: 'No autorizado para ejecutar borrados administrativos.' };
  }

  return { ok: true, email };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Metodo no permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'Variables de Supabase no disponibles en la funcion.' }, 500);
  }

  let body: { kind?: string; id?: string; deleteToken?: string };
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse({ ok: false, error: 'Solicitud invalida.' }, 400);
  }

  const kind = body.kind;
  const id = body.id || '';
  const deleteToken = body.deleteToken || '';

  if (!['document', 'measurement', 'measurement_bulk'].includes(kind || '')) {
    return jsonResponse({ ok: false, error: 'Tipo de registro invalido.' }, 400);
  }
  if (kind !== 'measurement_bulk' && (!UUID_PATTERN.test(id) || deleteToken.length < 12)) {
    return jsonResponse({ ok: false, error: 'Identificador de eliminacion invalido.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  if (kind === 'measurement_bulk') {
    const admin = await assertAdminRequest(req, supabase);
    if (!admin.ok) return jsonResponse({ ok: false, error: admin.error }, 403);

    const deleted = await supabase
      .from('irrigation_measurements')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('id');

    if (deleted.error) return jsonResponse({ ok: false, error: deleted.error.message }, 500);
    return jsonResponse({ ok: true, deletedCount: deleted.data?.length || 0 });
  }

  if (kind === 'measurement') {
    const { data, error } = await supabase
      .from('irrigation_measurements')
      .select('id, delete_token')
      .eq('id', id)
      .maybeSingle();

    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    if (!data) return jsonResponse({ ok: false, error: 'La medicion no existe en Supabase.' }, 404);
    if (data.delete_token !== deleteToken) {
      return jsonResponse({ ok: false, error: 'No autorizado para eliminar esta medicion.' }, 403);
    }

    const deleted = await supabase.from('irrigation_measurements').delete().eq('id', id);
    if (deleted.error) return jsonResponse({ ok: false, error: deleted.error.message }, 500);
    return jsonResponse({ ok: true });
  }

  const { data, error } = await supabase
    .from('conduction_documents')
    .select('id, delete_token, file_path')
    .eq('id', id)
    .maybeSingle();

  if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  if (!data) return jsonResponse({ ok: false, error: 'El documento no existe en Supabase.' }, 404);
  if (data.delete_token !== deleteToken) {
    return jsonResponse({ ok: false, error: 'No autorizado para eliminar este documento.' }, 403);
  }

  if (data.file_path) {
    const storageResult = await supabase.storage.from(DOCUMENT_BUCKET).remove([data.file_path]);
    if (storageResult.error) return jsonResponse({ ok: false, error: storageResult.error.message }, 500);
  }

  const deleted = await supabase.from('conduction_documents').delete().eq('id', id);
  if (deleted.error) return jsonResponse({ ok: false, error: deleted.error.message }, 500);
  return jsonResponse({ ok: true });
});
