import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchProcedureCatalog, procedureAction, PROCEDURE_CATEGORIES, queueProcedure } from '../lib/procedureSync';
import { MAX_PROCEDURE_PDF_BYTES, openStoredProcedure, procedureStore } from '../lib/proceduresStore';

export default function AdminProcedures({ procedures, session, isOnline }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('operacionales');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [existing, setExisting] = useState(null);
  const [retiring, setRetiring] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const input = useRef(null);
  const form = useRef(null);
  const email = session?.user?.email?.toLowerCase();
  const authorizationKey = `mantos_procedures_admin_${session?.user?.id}`;
  const enabled = allowed && !checking && !busy && !procedures.busy;

  async function refreshCatalog() {
    const documents = await fetchProcedureCatalog(supabase);
    setCatalog(documents.filter(document => document.is_active).sort((a,b) => a.title.localeCompare(b.title)));
  }
  useEffect(() => {
    let active = true;
    setChecking(true);
    (async () => {
      try {
        if (!isOnline) {
          const authorized = localStorage.getItem(authorizationKey) === email;
          if (!authorized) throw new Error('Conéctese una vez para verificar su permiso de publicación.');
          if (active) setAllowed(true);
        } else {
          await procedureAction(supabase, { action: 'authorize' });
          localStorage.setItem(authorizationKey, email);
          if (active) { setAllowed(true); setMessage(''); await refreshCatalog(); }
        }
      } catch (error) {
        if (active) { setAllowed(false); setMessage(error.message); }
        if (error.status === 401 || error.status === 403) localStorage.removeItem(authorizationKey);
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; };
  }, [session?.user?.id, isOnline]);

  const published = isOnline ? catalog : procedures.documents;
  function clearForm() { setTitle(''); setDescription(''); setCategory('operacionales'); setExisting(null); setFile(null); if (input.current) input.current.value = ''; }
  async function save(event) {
    event.preventDefault(); if (!enabled) return;
    setBusy(true); setMessage('');
    try { await queueProcedure({ title, description, category, file, existing, ownerEmail: email }); clearForm(); await procedures.reload(); setMessage('Borrador guardado en este dispositivo. Se publicará al sincronizar con conexión.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function synchronize() {
    setBusy(true);
    try { const result = await procedures.sync(); if (!result.ok) throw new Error(result.error || 'Se necesita conexión para sincronizar.'); await refreshCatalog(); setMessage('Procedimientos sincronizados y disponibles offline.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function retire() {
    if (!retiring || !enabled || !isOnline) return;
    setBusy(true);
    try { await procedureAction(supabase, { action: 'retire', id: retiring.id, version: retiring.version }); setRetiring(null); await procedures.sync(); await refreshCatalog(); setMessage('Documento retirado. Los usuarios recibirán el cambio cuando sincronicen.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <section className="admin-procedures">
    <div className="card admin-record-panel">
      <div className="admin-section-head"><div><span className="admin-section-eyebrow">Gestión documental</span><h3>Procedimientos</h3><p>Publique PDFs para que los usuarios consulten la versión actualizada sin conexión.</p></div></div>
      {checking && <p role="status">Verificando autorización…</p>}
      {(message || procedures.error) && <p className="procedure-feedback" role="status">{message || procedures.error}</p>}
      {!isOnline && <p className="procedure-feedback">Sin conexión. Los borradores y las copias guardadas permanecen en este dispositivo.</p>}
      {allowed && <>
        <form className="procedure-editor" ref={form} onSubmit={save}>
          <div className="procedure-editor-head"><h4>{existing ? 'Reemplazar procedimiento' : 'Nuevo procedimiento'}</h4>{existing && <span>Versión actual: {existing.version}</span>}</div>
          <div className="form-group"><label htmlFor="procedure-title">Título</label><input id="procedure-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={180} required disabled={!enabled} placeholder="Ej.: Procedimiento de izaje" /></div>
          <div className="form-group"><label htmlFor="procedure-category">Categoría</label><select id="procedure-category" value={category} onChange={event => setCategory(event.target.value)} disabled={!enabled}>{PROCEDURE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
          <div className="form-group"><label htmlFor="procedure-description">Descripción</label><textarea id="procedure-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} disabled={!enabled} placeholder="Indique el alcance o los cambios de esta versión." /></div>
          <div className="procedure-file-picker"><label htmlFor="procedure-file">Documento PDF · máximo {MAX_PROCEDURE_PDF_BYTES / 1024 / 1024} MB</label><input ref={input} id="procedure-file" type="file" accept=".pdf,application/pdf" required disabled={!enabled} onChange={event => setFile(event.target.files?.[0] || null)} />{file && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</small>}</div>
          <div className="procedure-editor-actions"><button type="submit" className="btn-save" disabled={!enabled || !file}>{busy ? 'Guardando…' : 'Guardar pendiente'}</button>{existing && <button className="btn-secondary" type="button" onClick={clearForm} disabled={!enabled}>Cancelar reemplazo</button>}</div>
          <p className="procedure-helper">El PDF se guarda localmente antes de publicarse. La versión anterior continúa vigente hasta confirmar la nueva carga.</p>
        </form>
        <div className="procedure-list-heading"><h4>Pendientes de publicación</h4><span>{procedures.drafts.length}</span></div>
        {!procedures.drafts.length && <p className="procedure-helper">No hay borradores pendientes.</p>}
        {procedures.drafts.map(draft => <article className="procedure-admin-document" key={draft.id}><div><strong>{draft.metadata.title}</strong><small>{draft.expected_version ? 'Reemplazo' : 'Nuevo documento'} · {draft.metadata.filename}</small>{draft.error && <p className="procedure-draft-error">{draft.error}</p>}</div><button type="button" className="btn-secondary" disabled={!enabled} onClick={async () => { try { await procedureStore('drafts', 'delete', draft.id); await procedures.reload(); } catch(error) { setMessage(error.message); } }}>Descartar</button></article>)}
        <button className="btn-save procedure-sync-button" type="button" onClick={synchronize} disabled={!enabled || !isOnline}>{procedures.busy ? 'Sincronizando…' : 'Sincronizar procedimientos'}</button>
      </>}
    </div>
    {allowed && <div className="card admin-record-panel"><div className="procedure-list-heading"><h3>Documentos publicados</h3><span>{published.length}</span></div>
      {!published.length && <p className="procedure-helper">Aún no hay procedimientos publicados.</p>}
      {published.map(document => <article className="procedure-admin-document" key={document.id}><div><strong>{document.title}</strong><small>{PROCEDURE_CATEGORIES.find(c => c.id === document.category)?.title} · v{document.version} · {new Date(document.updated_at).toLocaleDateString('es-CL')}</small><small>{document.filename}</small></div><div className="procedure-document-actions">
        <button type="button" className="btn-secondary" disabled={!enabled || !procedures.documents.some(d => d.id === document.id && d.blob)} onClick={() => openStoredProcedure(document.id).catch(error => setMessage(error.message))}>Abrir PDF</button>
        <button type="button" className="btn-secondary" disabled={!enabled} onClick={() => { setExisting(document); setTitle(document.title); setDescription(document.description); setCategory(document.category); setFile(null); if (input.current) input.current.value = ''; form.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }}>Reemplazar</button>
        <button type="button" className="procedure-retire" disabled={!enabled || !isOnline} onClick={() => setRetiring(document)}>Retirar</button>
      </div></article>)}
    </div>}
    {retiring && <div className="modal-overlay open" role="dialog" aria-modal="true" aria-labelledby="procedure-retire-title"><div className="modal-box"><h3 id="procedure-retire-title">Retirar procedimiento</h3><p>«{retiring.title}» dejará de estar disponible para los usuarios cuando sincronicen. Las copias offline se retirarán al recuperar conexión.</p><div className="modal-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setRetiring(null)}>Cancelar</button><button className="danger-button" type="button" disabled={busy} onClick={retire}>Retirar documento</button></div></div></div>}
  </section>;
}
