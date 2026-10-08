import { useState } from 'react';
import { calculateWeightGeometry, convertDimension, LIFTING_MATERIALS, WEIGHT_SHAPES } from '../lib/weightGeometry';

function ShapeIllustration({ shape, hollow = false }) {
  return (
    <svg className="weight-shape-image" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        {(shape === 'cube' || shape === 'cuboid') && <>
          <path fill="currentColor" fillOpacity=".10" d={shape === 'cube' ? 'M25 35 60 15 95 35 60 55Z' : 'M15 40 45 20 105 30 75 50Z'} />
          <path fill="currentColor" fillOpacity=".25" d={shape === 'cube' ? 'M25 35 60 55 60 90 25 70Z' : 'M15 40 75 50 75 80 15 70Z'} />
          <path fill="currentColor" fillOpacity=".45" d={shape === 'cube' ? 'M60 55 95 35 95 70 60 90Z' : 'M75 50 105 30 105 60 75 80Z'} />
        </>}
        {shape === 'cylinder' && <>
          <path fill="currentColor" fillOpacity=".25" d="M30 25V75C30 94 90 94 90 75V25" />
          <ellipse cx="60" cy="25" rx="30" ry="12" fill="currentColor" fillOpacity=".12" />
          {hollow && <ellipse cx="60" cy="25" rx="19" ry="7" fill="var(--bg-card)" />}
        </>}
        {shape === 'sphere' && <>
          <circle cx="60" cy="50" r="36" fill="currentColor" fillOpacity=".18" />
          <ellipse cx="60" cy="50" rx="15" ry="36" fill="none" />
          <ellipse cx="60" cy="50" rx="36" ry="13" fill="none" strokeDasharray="4 4" />
        </>}
        {shape === 'cone' && <>
          <path d="M25 78 60 12 95 78" fill="currentColor" fillOpacity=".25" />
          <ellipse cx="60" cy="78" rx="35" ry="11" fill="currentColor" fillOpacity=".12" />
          <path d="M60 12V78" strokeDasharray="4 4" fill="none" />
        </>}
        {shape === 'pyramid' && <>
          <path d="M18 72 58 12 103 68 65 91Z" fill="currentColor" fillOpacity=".18" />
          <path d="M58 12 65 91 103 68Z" fill="currentColor" fillOpacity=".35" />
          <path d="M18 72 54 54 103 68M58 12 54 54" fill="none" strokeDasharray="4 4" />
        </>}
      </g>
    </svg>
  );
}

const numberFormat = new Intl.NumberFormat('es-CL', { maximumSignificantDigits: 8 });
function displayNumber(value) { return numberFormat.format(value); }

export default function LiftingWeightCalculator() {
  const [shapeId, setShapeId] = useState('cuboid');
  const [material, setMaterial] = useState(LIFTING_MATERIALS[0].name);
  const [unit, setUnit] = useState('cm');
  const [hollow, setHollow] = useState(false);
  const [measurements, setMeasurements] = useState({});
  const [touched, setTouched] = useState({});
  const shape = WEIGHT_SHAPES.find((item) => item.id === shapeId);
  const density = LIFTING_MATERIALS.find((item) => item.name === material).density;
  const values = measurements[shapeId] || {};
  const isHollow = shapeId === 'cylinder' && hollow;
  const fields = isHollow ? [...shape.fields, ['thickness', 'Espesor de pared']] : shape.fields;
  const result = calculateWeightGeometry(shapeId, values, unit, density, isHollow);
  const unitLabel = unit === 'in' ? 'pulg' : unit;
  const formula = isHollow ? 'V = π × longitud × (radio exterior² − radio interior²)' : shape.formula;

  function changeUnit(nextUnit) {
    if (nextUnit === unit) return;
    setMeasurements((current) => Object.fromEntries(Object.entries(current).map(([id, dimensions]) => [id, Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, convertDimension(value, unit, nextUnit)]))])));
    setUnit(nextUnit);
  }

  return (
    <section className="weight-workspace" aria-label="Calculadora de peso por geometría">
      <div className="section-heading">
        <span>Cálculo de peso</span>
        <h2>De la forma al peso</h2>
        <p>Seleccione la geometría, el material y las dimensiones de su objeto.</p>
      </div>
      <div className="card weight-shape-picker">
        <h3>Forma del objeto</h3>
        <div className="weight-shape-grid" role="group" aria-label="Forma del objeto">
          {WEIGHT_SHAPES.map((item) => <button key={item.id} type="button" className={`weight-shape-option ${shapeId === item.id ? 'selected' : ''}`} aria-pressed={shapeId === item.id} onClick={() => setShapeId(item.id)}>
            <ShapeIllustration shape={item.id} />
            <strong>{item.name}</strong><small>{item.hint}</small>
            {shapeId === item.id && <span className="weight-selected-tag">✓ Seleccionado</span>}
          </button>)}
        </div>
      </div>
      <div className="weight-detail-grid">
        <div className="card weight-input-card">
          <div className="weight-geometry-summary">
            <ShapeIllustration shape={shapeId} hollow={isHollow} />
            <div><h3>{shape.name}{isHollow ? ' hueco' : ''}</h3><p>{formula}</p></div>
          </div>
          {shapeId === 'cylinder' && <div className="weight-segment" role="group" aria-label="Tipo de cilindro">
            <button type="button" aria-pressed={!hollow} className={!hollow ? 'active' : ''} onClick={() => setHollow(false)}>Macizo</button>
            <button type="button" aria-pressed={hollow} className={hollow ? 'active' : ''} onClick={() => setHollow(true)}>Tubo hueco</button>
          </div>}
          <div className="form-group">
            <label htmlFor="lifting-material">Material</label>
            <select id="lifting-material" value={material} onChange={(event) => setMaterial(event.target.value)}>
              {LIFTING_MATERIALS.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            <p className="weight-field-hint">Densidad: <strong>{displayNumber(density)} kg/m³</strong></p>
          </div>
          <div className="weight-unit-row"><span>Unidad de dimensiones</span>
            <div className="weight-segment" role="group" aria-label="Unidad de dimensiones">
              {[['cm', 'cm'], ['m', 'm'], ['in', 'pulg']].map(([id, label]) => <button key={id} type="button" aria-pressed={unit === id} className={unit === id ? 'active' : ''} onClick={() => changeUnit(id)}>{label}</button>)}
            </div>
          </div>
          <p className="weight-field-hint">Al cambiar la unidad se convierten las dimensiones ingresadas.</p>
          <div className="weight-dimension-grid">
            {fields.map(([key, label]) => {
              const inputId = `weight-${shapeId}-${key}`;
              const error = touched[inputId] && result.errors[key];
              return <div className="form-group" key={inputId}>
                <label htmlFor={inputId}>{label} ({unitLabel})</label>
                <input id={inputId} type="text" inputMode="decimal" autoComplete="off" placeholder="Ej.: 120" value={values[key] ?? ''} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
                  onBlur={() => setTouched((current) => ({ ...current, [inputId]: true }))}
                  onChange={(event) => setMeasurements((current) => ({ ...current, [shapeId]: { ...current[shapeId], [key]: event.target.value } }))} />
                {error && <p id={`${inputId}-error`} className="weight-input-error">{error}</p>}
              </div>;
            })}
          </div>
          {isHollow && <p className="weight-field-hint">El diámetro es exterior y el espesor corresponde a una pared del tubo.</p>}
          {(shapeId === 'cone' || shapeId === 'pyramid') && <p className="weight-field-hint">Mida la altura perpendicular desde la base hasta el vértice.</p>}
        </div>
        <div className="card weight-output-card" aria-live="polite" aria-atomic="true">
          <span className="weight-output-eyebrow">Resultado del cálculo</span>
          <h3>Peso del objeto</h3>
          {result.status === 'ready' ? <>
            <div className="weight-primary-result"><strong>{displayNumber(result.weight)}</strong><span>kg</span></div>
            <p className="weight-tonnes">{displayNumber(result.weight / 1000)} toneladas</p>
            <dl className="weight-breakdown"><div><dt>Volumen</dt><dd>{displayNumber(result.volume)} m³</dd></div><div><dt>Material</dt><dd>{material}</dd></div><div><dt>Densidad</dt><dd>{displayNumber(density)} kg/m³</dd></div></dl>
          </> : <div className="weight-result-placeholder"><ShapeIllustration shape={shapeId} hollow={isHollow} /><strong>{result.status === 'invalid' ? 'Revise las dimensiones' : 'Complete las dimensiones'}</strong><p>{result.message || (result.status === 'invalid' ? 'Corrija los valores indicados para obtener el peso.' : 'El volumen y el peso aparecerán automáticamente.')}</p></div>}
          <div className="weight-calculation-note"><strong>Peso = volumen × densidad</strong><p>Calculado con la densidad de {material} registrada en la app.</p></div>
        </div>
      </div>
    </section>
  );
}
