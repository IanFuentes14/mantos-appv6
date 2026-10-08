import { procedureStore, pdfHash, validatePdf } from './proceduresStore';
export const PROCEDURE_CATEGORIES = [
  { id: 'operacionales', title: 'Operacionales' }, { id: 'seguridad', title: 'Seguridad' },
  { id: 'equipos', title: 'Equipos' }, { id: 'administrativos', title: 'Administrativos' },
];
function bounded(promise, timeoutMs = 45000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La conexión tardó demasiado. El borrador y las copias offline se conservan.')), timeoutMs); })]).finally(() => clearTimeout(timer));
}
export async function procedureAction(client, body) {
  const { data, error } = await bounded(client.functions.invoke('manage-procedures', { body }));
  if (error) {
    let details;
    try { details = await error.context?.json(); } catch { /* Preserve the original error if no JSON is available. */ }
    const failure = new Error(details?.error || 'No se pudo acceder a la gestión de procedimientos. Revise la conexión y la activación del servicio.');
    failure.code = details?.code;
    failure.status = error.context?.status;
    throw failure;
  }
  if (!data?.ok) throw new Error(data?.error || 'No se confirmó la operación.');
  return data;
}

export async function queueProcedure({ title, description, category, file, existing, ownerEmail }) {
  if (!ownerEmail) throw new Error('Ingrese con su cuenta administrativa.');
  if (!title.trim() || title.length > 180 || description.length > 2000 || !PROCEDURE_CATEGORIES.some(c => c.id === category)) throw new Error('Revise el título, la categoría y la descripción.');
  await validatePdf(file);
  const id = crypto.randomUUID();
  const draft = { id, procedure_id: existing?.id || crypto.randomUUID(), expected_version: existing?.version || 0, owner_email: ownerEmail.toLowerCase(), created_at: new Date().toISOString(), blob: file,
    metadata: { title: title.trim(), description: description.trim(), category, filename: file.name.slice(0, 180), size_bytes: file.size, sha256: await pdfHash(file) } };
  if (!draft.metadata.filename.toLowerCase().endsWith('.pdf')) throw new Error('El nombre del archivo debe terminar en .pdf.');
  const drafts = await procedureStore('drafts', 'getAll');
  if (drafts.some(d => d.procedure_id === draft.procedure_id)) throw new Error('Ya existe un reemplazo pendiente para este documento. Sincronícelo o descarte el borrador primero.');
  await procedureStore('drafts', 'put', draft);
  return draft;
}

export async function publishDraft(client, draft) {
  const prepared = await procedureAction(client, { action: 'prepare', upload_id: draft.id, procedure_id: draft.procedure_id, expected_version: draft.expected_version, metadata: draft.metadata });
  if (!prepared.completed) {
    try { await procedureAction(client, { action: 'finalize', upload_id: draft.id }); }
    catch (error) {
      if (error.code !== 'missing_file') throw error;
      const uploaded = await bounded(client.storage.from('procedure-pdfs').uploadToSignedUrl(prepared.path, prepared.token, draft.blob, { contentType: 'application/pdf' }), 5 * 60 * 1000);
      // A previous attempt may have uploaded this immutable object before losing its response.
      if (uploaded.error && !['409', '400'].includes(String(uploaded.error.statusCode))) throw uploaded.error;
      await procedureAction(client, { action: 'finalize', upload_id: draft.id });
    }
  }
  await procedureStore('drafts', 'delete', draft.id);
}

export async function fetchProcedureCatalog(client) {
  const documents = [];
  for (let offset = 0; ; offset += 500) {
    const response = await bounded(client.from('procedures').select('*').order('id').range(offset, offset + 499));
    if (response.error) throw new Error('No se pudo actualizar el catálogo de procedimientos. Las copias offline se conservan.');
    documents.push(...response.data);
    if (response.data.length < 500) break;
  }
  return documents;
}
export async function syncProcedureCatalog(client) {
  const documents = await fetchProcedureCatalog(client);
  const failures = [];
  for (const document of documents) {
    if (!document.is_active) { await procedureStore('documents', 'delete', document.id); continue; }
    const local = await procedureStore('documents', 'get', document.id);
    if (local?.blob && local.version === document.version && local.sha256 === document.sha256) continue;
    try {
      const result = await bounded(client.storage.from('procedure-pdfs').download(document.storage_path));
      if (result.error) throw result.error;
      await validatePdf(result.data);
      if (await pdfHash(result.data) !== document.sha256) throw new Error('La integridad del PDF no coincide.');
      await procedureStore('documents', 'put', { ...document, blob: result.data });
    } catch {
      if (!local) await procedureStore('documents', 'put', { ...document, blob: null });
      failures.push(document.title);
    }
  }
  if (failures.length) throw new Error(`No se descargaron ${failures.length} PDF(s): ${failures.join(', ')}. Las versiones offline anteriores se conservan.`);
}
