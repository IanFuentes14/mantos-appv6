import { useEffect, useState } from 'react';
import { PROCEDURE_CATEGORIES } from '../lib/procedureSync';
import { openStoredProcedure } from '../lib/proceduresStore';

export default function ProcedureLibrary({ procedures, isOnline }) {
  const [error, setError] = useState('');
  useEffect(() => { if (isOnline) procedures.sync(); }, []);
  return <>
    <div className="section-heading"><span>Biblioteca de terreno</span><h2>Procedimientos</h2><p>Los PDFs sincronizados quedan guardados en este dispositivo para consultar sin conexión.</p></div>
    <button type="button" className="btn-secondary procedure-user-sync-button" disabled={procedures.busy || !isOnline} onClick={() => procedures.sync()}>{procedures.busy ? 'Descargando procedimientos…' : 'Actualizar procedimientos'}</button>
    {!isOnline && <p className="procedure-feedback">Sin conexión. Se muestran las versiones guardadas en este dispositivo.</p>}
    {(error || procedures.error) && <p className="procedure-feedback" role="status">{error || procedures.error}</p>}
    <div className="procedure-category-list">
      {PROCEDURE_CATEGORIES.map(category => {
        const documents = procedures.documents.filter(document => document.category === category.id);
        return <section className="card procedure-category-card" key={category.id}><div className="procedure-category-head"><h3>Procedimientos {category.title.toLowerCase()}</h3><span>{documents.length}</span></div>
          {documents.length ? <div className="procedure-document-list">{documents.map(document => <button className="procedure-document-button" key={document.id} type="button" disabled={!document.blob} onClick={() => { setError(''); openStoredProcedure(document.id).catch(failure => setError(failure.message)); }}><span>PDF</span><strong>{document.title}</strong><small>v{document.version} · {new Date(document.updated_at).toLocaleDateString('es-CL')} · {document.blob ? 'Disponible offline' : 'Descarga pendiente'}</small></button>)}</div> : <div className="procedure-empty-state"><strong>No hay documentos disponibles</strong><span>Sincronice con conexión para recibir los procedimientos publicados.</span></div>}
        </section>;
      })}
    </div>
  </>;
}
