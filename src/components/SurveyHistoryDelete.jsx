import { useId, useRef, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function SurveyHistoryDelete({ category, title, disabled, onDeleted }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const id = useId(), dialog = useRef(null), trigger = useRef(null), cancel = useRef(null);
  const all = category === undefined;
  useEffect(() => {
    if (!open) return;
    cancel.current?.focus();
    return () => trigger.current?.focus();
  }, [open]);
  async function remove() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!navigator.onLine || !supabase) throw new Error('Se requiere conexión para eliminar el historial.');
      const { data, error } = await supabase.functions.invoke('delete-local-record', { body: { kind: 'survey_bulk', ...(all ? {} : { category }) } });
      if (error) {
        let detail; try { detail = await error.context?.json(); } catch { /* Use the safe default below. */ }
        throw new Error(detail?.error || 'No se pudo eliminar el historial. Revise la sesión y la conexión.');
      }
      if (!data?.ok) throw new Error(data?.error || 'No se confirmó la eliminación.');
      setOpen(false); setMessage(`Se eliminaron ${data.deletedCount ?? 0} accesos del historial.`);
      try { await onDeleted?.(category); } catch { setMessage('Historial eliminado. Actualice la pantalla para consultar los registros actuales.'); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function keys(event) {
    if (event.key === 'Escape' && !busy) { setOpen(false); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.current.querySelectorAll('button:not(:disabled)')];
    if (!items.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  }
  return <div className="survey-delete-control">
    <button ref={trigger} className="danger-button" type="button" disabled={disabled || busy || !navigator.onLine} onClick={() => { setError(''); setOpen(true); }}>{all ? 'Eliminar todo el historial' : 'Eliminar historial de esta encuesta'}</button>
    {message && <p role="status" className="admin-export-message">{message}</p>}
    {open && <div className="modal-overlay open"><div ref={dialog} className="modal-box danger-confirm-modal" role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={id+'-description'} onKeyDown={keys}>
      <h3 id={id}>{all ? 'Eliminar todo el historial de encuestas' : `Eliminar historial: ${title}`}</h3>
      <p id={id+'-description'} className="modal-text">{all ? 'Se eliminarán todos los accesos a encuestas sincronizados, incluidos los que no se muestran en esta pantalla.' : 'Se eliminarán todos los accesos sincronizados de esta encuesta, incluidos los que no se muestran en esta pantalla.'} El borrado es definitivo. Los formularios y sus respuestas externas no se modifican.</p>
      {error && <p role="alert" className="procedure-feedback">{error}</p>}
      {busy && <p role="status">Eliminando historial…</p>}
      <div className="modal-actions"><button ref={cancel} type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="danger-button" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button></div>
    </div></div>}
  </div>;
}
