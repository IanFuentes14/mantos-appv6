import { useEffect, useRef, useState } from 'react';
import { supabase, operatorSupabase } from './supabase';
import { ensureOperatorSession, getAdminSession } from './authSession';
import { procedureStore } from './proceduresStore';
import { publishDraft, syncProcedureCatalog } from './procedureSync';

export function useProcedures({ accessRole, session, isOnline }) {
  const [documents, setDocuments] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef({ accessRole, session, isOnline });
  current.current = { accessRole, session, isOnline };
  const running = useRef(null);
  async function reload() {
    try {
      const [docs, queued] = await Promise.all([procedureStore('documents', 'getAll'), procedureStore('drafts', 'getAll')]);
      setDocuments(docs.sort((a,b) => a.title.localeCompare(b.title)));
      const email = current.current.session?.user?.email?.toLowerCase();
      setDrafts(current.current.accessRole === 'admin' ? queued.filter(d => d.owner_email === email) : []);
    } catch (failure) { setError(failure.message); }
  }
  async function sync() {
    if (running.current) return running.current;
    const state = current.current;
    if (!navigator.onLine || !state.accessRole || !supabase) { await reload(); return { ok: false }; }
    setBusy(true); setError('');
    running.current = (async () => {
      try {
        const client = state.accessRole === 'admin' ? supabase : operatorSupabase;
        if (state.accessRole === 'admin') {
          const auth = await getAdminSession(client);
          const queued = await procedureStore('drafts', 'getAll');
          for (const draft of queued.filter(d => d.owner_email === auth.user.email.toLowerCase())) {
            try { await publishDraft(client, draft); }
            catch (failure) { await procedureStore('drafts', 'put', { ...draft, error: failure.message }); throw failure; }
          }
        } else await ensureOperatorSession(client);
        await syncProcedureCatalog(client);
        return { ok: true };
      } catch (failure) { setError(failure.message); return { ok: false, error: failure.message }; }
      finally { await reload(); setBusy(false); running.current = null; }
    })();
    return running.current;
  }
  useEffect(() => {
    reload();
    const changed = () => reload();
    window.addEventListener('mantos-procedures-changed', changed);
    return () => window.removeEventListener('mantos-procedures-changed', changed);
  }, [accessRole, session?.user?.email]);
  useEffect(() => {
    if (!accessRole || !isOnline) return;
    sync();
    const foreground = () => { if (!document.hidden) sync(); };
    const retry = setInterval(foreground, 60000);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', foreground);
    return () => { clearInterval(retry); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('focus', foreground); };
  }, [accessRole, isOnline, session?.user?.id]);
  return { documents, drafts, error, busy, sync, reload };
}
