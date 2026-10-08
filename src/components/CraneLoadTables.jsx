import { useState } from 'react';
import { CRANE_MODELS } from '../lib/craneCatalog';

const number = (value) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);

export default function CraneLoadTables({ onPreview }) {
  const [brand, setBrand] = useState('');
  const [series, setSeries] = useState('');
  const [modelId, setModelId] = useState('');
  const seriesNames = [...new Set(CRANE_MODELS.filter((model) => model.brand === brand).map((model) => model.series))];
  const models = CRANE_MODELS.filter((model) => model.brand === brand && model.series === series);
  const model = models.find((item) => item.id === modelId);
  return <section className="card lift-workspace lift-table-library">
    <div className="section-heading"><span>Biblioteca de equipos</span><h2>Tablas de carga</h2><p>Seleccione marca, serie y versión. Los mismos puntos alimentan el apartado Izaje.</p></div>
    <div className="lift-fields">
      <div className="form-group"><label htmlFor="crane-table-brand">Marca</label><select id="crane-table-brand" value={brand} onChange={(event) => { setBrand(event.target.value); setSeries(''); setModelId(''); }}><option value="">Seleccione marca</option>{['Fassi', 'Palfinger'].map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="form-group"><label htmlFor="crane-table-series">Serie</label><select id="crane-table-series" value={series} disabled={!brand} onChange={(event) => { setSeries(event.target.value); setModelId(''); }}><option value="">Seleccione serie</option>{seriesNames.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="form-group"><label htmlFor="crane-table-model">Versión / submodelo</label><select id="crane-table-model" value={modelId} disabled={!series} onChange={(event) => setModelId(event.target.value)}><option value="">Seleccione versión</option>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    </div>
    {model ? <>
      <div className="lift-chart-info"><strong>{model.brand} {model.label}</strong><p>{model.condition}</p><a href={model.source} target="_blank" rel="noopener noreferrer">Consultar fuente del fabricante</a></div>
      {model.image && <button type="button" className="image-preview-button" onClick={() => onPreview({ src: model.image, title: model.label })}><img src={model.image} alt={`Tabla original ${model.label}; incluye prolongas manuales que no forman parte del cálculo automático`} /></button>}
      <table className="lift-capacity-table"><caption>Puntos de alcance hidráulico usados en Izaje</caption><thead><tr><th scope="col">Alcance (m)</th><th scope="col">Capacidad (kg)</th></tr></thead><tbody>{model.points.map((point) => <tr key={point.radius}><td>{number(point.radius)}</td><td>{number(point.capacity)}</td></tr>)}</tbody></table>
      <p className="lift-hint">Datos de referencia para la versión y posición indicadas. Confirme la tabla del equipo instalado y sus restricciones. No se interpolan alcances ni se incluyen jib o extensiones manuales.</p>
    </> : <p className="lift-hint">Hay {CRANE_MODELS.length} versiones disponibles. Seleccione una para consultar sus capacidades.</p>}
  </section>;
}
