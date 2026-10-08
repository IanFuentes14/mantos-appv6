import { useState } from 'react';
import { assessLift, SLING_HITCHES, SLING_LENGTHS, yaganCapacity } from '../lib/liftAssessment';
import { CRANE_MODELS, cranePoint } from '../lib/craneCatalog';

const format = (number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(number);

function HitchImage({ hitch }) {
  return <svg className="lift-hitch-image" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M80 5V17C95 17 93 35 80 35C70 35 65 28 69 23" />
      <rect x="35" y="70" width="90" height="34" rx="5" fill="currentColor" fillOpacity=".12" strokeWidth="2" />
      {hitch === 'axial' && <><path d="M80 35V70" /><circle cx="80" cy="70" r="5" fill="var(--bg-card)" /></>}
      {hitch === 'choker' && <><path d="M80 35 54 74V99C54 112 106 112 106 99V78L74 58" /><ellipse cx="73" cy="57" rx="8" ry="5" /></>}
      {hitch === 'basket' && <path d="M77 35 31 76V98Q31 112 45 112H115Q129 112 129 98V76L83 35" />}
    </g>
  </svg>;
}

function AngleImage({ angle }) {
  const numeric = Number(String(angle).replace(',', '.'));
  const degrees = Number.isFinite(numeric) && numeric >= 30 && numeric <= 90 ? numeric : 60;
  const rise = 70 * Math.sin(degrees * Math.PI / 180);
  const spread = 70 * Math.cos(degrees * Math.PI / 180);
  return <svg className="lift-angle-image" viewBox="0 0 220 110" role="img" aria-label="Ángulo de cada ramal medido desde la horizontal, no entre eslingas">
    <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d={`M${110-spread} 84L110 ${84-rise}L${110+spread} 84`} />
      <path d="M25 84H195" strokeDasharray="4 5" strokeWidth="1.5" />
      <path d={`M${110+spread-22} 84Q${110+spread-22} 70 ${110+spread-12} 65`} strokeWidth="1.5" />
      <rect x="38" y="84" width="144" height="17" rx="3" fill="currentColor" fillOpacity=".12" strokeWidth="1.5" />
    </g>
    <text x="160" y="65" fill="currentColor" fontSize="15">θ</text>
  </svg>;
}

function Step({ number, title, children }) {
  return <section className="card lift-step"><div className="lift-step-heading"><span aria-hidden="true">{number}</span><h3>{title}</h3></div>{children}</section>;
}

export default function LiftAssessment() {
  const [input, setInput] = useState({ length: 1.2, count: 1, hitch: 'axial', angle: '', ratedCapacity: yaganCapacity(1.2, 'axial'), craneMode: 'catalog', craneModel: '', radius: '', boom: '', configuration: '', craneCapacity: '', load: '', belowAccessories: '0', craneAccessories: '0' });
  const [reference, setReference] = useState(true);
  const [evaluated, setEvaluated] = useState(false);
  const [touched, setTouched] = useState({});
  const result = assessLift(input);
  const model = CRANE_MODELS.find((item) => item.id === input.craneModel);
  const point = cranePoint(input.craneModel, input.radius);
  const angleNeeded = input.count > 1 || input.hitch === 'basket';
  const ready = ['within', 'exceeded'].includes(result.status);

  function change(key, value) {
    setInput((current) => {
      const next = { ...current, [key]: value };
      if (key === 'hitch' || key === 'length') next.ratedCapacity = reference ? yaganCapacity(next.length, next.hitch) : '';
      if (['craneModel', 'craneMode'].includes(key)) { next.radius = ''; next.craneCapacity = ''; next.configuration = ''; }
      return next;
    });
  }

  function field(key, label, hint, placeholder = '') {
    const error = (evaluated || touched[key]) && result.errors[key];
    return <div className="form-group"><label htmlFor={`lift-${key}`}>{label}</label><input id={`lift-${key}`} type="text" inputMode="decimal" autoComplete="off" value={input[key]} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} onBlur={() => setTouched((current) => ({ ...current, [key]: true }))} aria-invalid={Boolean(error)} aria-describedby={`lift-${key}-hint${error ? ` lift-${key}-error` : ''}`} /><p id={`lift-${key}-hint`} className="lift-hint">{hint}</p>{error && <p id={`lift-${key}-error`} className="weight-input-error">{error}</p>}</div>;
  }
  return <section className="lift-workspace" aria-label="Evaluación de capacidad de izaje">
    <div className="section-heading"><span>Planificación de la maniobra</span><h2>Izaje</h2><p>Compare el peso con la capacidad de las eslingas y de la grúa.</p></div>
    <form noValidate onSubmit={(event) => { event.preventDefault(); setEvaluated(true); }}>
      <Step number="01" title="¿Qué tipo de eslinga utilizarás?">
        <p className="lift-hint">Eslinga plana Yagán de 50 mm y 2 capas. La referencia cambia según el largo y el posicionamiento; confirme la etiqueta de la eslinga.</p>
        <div className="lift-choices" role="group" aria-label="Largo de eslinga">{SLING_LENGTHS.map((length) => <button type="button" key={length} className={input.length === length ? 'selected' : ''} aria-pressed={input.length === length} onClick={() => change('length', length)}><strong>{format(length)} m</strong></button>)}</div>
        <div className="lift-quantity"><div><strong>¿Cuántas utilizarás?</strong><p className="lift-hint">Hasta 4 eslingas iguales.</p></div><div className="lift-choices" role="group" aria-label="Cantidad de eslingas">{[1,2,3,4].map((count) => <button key={count} type="button" aria-pressed={input.count === count} className={input.count === count ? 'selected' : ''} onClick={() => change('count', count)}>{count}</button>)}</div></div>
        {input.count === 4 && <p className="lift-note">Con 4 eslingas se calcula con 3 trabajando como estimación conservadora. No se asume que las cuatro reparten el peso por igual.</p>}
      </Step>
      <Step number="02" title="¿Cómo las posicionarás?">
        <div className="lift-hitches" role="group" aria-label="Posicionamiento de eslingas">{SLING_HITCHES.map((hitch) => <button type="button" key={hitch.id} className={input.hitch === hitch.id ? 'selected' : ''} aria-pressed={input.hitch === hitch.id} onClick={() => change('hitch', hitch.id)}><HitchImage hitch={hitch.id} /><strong>{hitch.name}</strong><small>{hitch.hint}</small></button>)}</div>
        <div className="lift-fields">
          <div className="form-group"><label htmlFor="lift-profile">Capacidad de referencia</label><select id="lift-profile" value={reference ? 'yagan' : 'label'} onChange={(event) => { const useReference = event.target.value === 'yagan'; setReference(useReference); change('ratedCapacity', useReference ? yaganCapacity(input.length, input.hitch) : ''); }}><option value="yagan">Yagán · 50 mm · 2 capas · ASME 5:1</option><option value="label">Otra capacidad según etiqueta</option></select><p className="lift-hint">Yagán 1,2 m: axial 2,8 t, lazo aprox. 2,24 t, canasta 5,6 t. Yagán 4 / 6 m: axial 2,9 t, lazo 2,32 t, canasta 5,8 t. Yagán 10 m: axial 2,8 t, lazo 2,2 t, canasta 5,6 t.</p></div>
          {field('ratedCapacity', `Capacidad por eslinga en ${SLING_HITCHES.find((hitch) => hitch.id === input.hitch).name.toLowerCase()} (kg)`, 'Referencia Yagán: 50 mm y 2 capas. Edite según la etiqueta; ingrese carga de trabajo, no de rotura.')}
        </div>
        {angleNeeded && <div className="lift-angle"><AngleImage angle={input.angle} /><div>{field('angle', 'Ángulo de trabajo θ (°)', 'Estimación con ramales simétricos. Mida desde la horizontal; use el menor ángulo. 90° = vertical.', 'Ej.: 60')}<div className="lift-choices" role="group" aria-label="Ángulos frecuentes">{[30,45,60,90].map((angle) => <button type="button" key={angle} aria-pressed={String(input.angle) === String(angle)} onClick={() => change('angle', String(angle))}>{angle}°</button>)}</div></div></div>}
        {input.hitch === 'choker' && <p className="lift-hint">Se aplica la capacidad de lazo de la eslinga. La referencia supone un estrangulamiento estándar de al menos 120°.</p>}
      </Step>
      <Step number="03" title="¿Qué grúa y alcance utilizarás?">
        <div className="lift-choices" role="group" aria-label="Origen de la capacidad de la grúa"><button type="button" className={input.craneMode === 'catalog' ? 'selected' : ''} aria-pressed={input.craneMode === 'catalog'} onClick={() => change('craneMode', 'catalog')}>Tablas de la app</button><button type="button" className={input.craneMode === 'manual' ? 'selected' : ''} aria-pressed={input.craneMode === 'manual'} onClick={() => change('craneMode', 'manual')}>Otra configuración</button></div>
        {input.craneMode === 'catalog' ? <>
          <div className="lift-fields"><div className="form-group"><label htmlFor="lift-model">Modelo de grúa</label><select id="lift-model" value={input.craneModel} onChange={(event) => change('craneModel', event.target.value)}><option value="">Seleccione modelo</option>{['Fassi', 'Palfinger'].map((brand) => <optgroup label={brand} key={brand}>{CRANE_MODELS.filter((item) => item.brand === brand).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></div><div className="form-group"><label htmlFor="lift-radius">Alcance / radio de la tabla (m)</label><select id="lift-radius" value={input.radius} disabled={!model} onChange={(event) => change('radius', event.target.value)}><option value="">Seleccione alcance</option>{model?.points.map((item) => <option key={item.radius} value={item.radius}>{format(item.radius)} m</option>)}</select></div></div>
          <p className="lift-hint">En estas grúas articuladas, el alcance es la distancia horizontal al punto de carga; no es el largo físico de la pluma. Se usan puntos publicados, sin interpolar.</p>
          {model && <div className="lift-chart-info"><strong>{model.brand} {model.label}</strong><p>{model.condition}</p><a href={model.source} target="_blank" rel="noopener noreferrer">Consultar fuente del fabricante</a></div>}
          <div className="lift-chart-capacity"><span>Capacidad al alcance seleccionado</span><strong>{point ? `${format(point.capacity)} kg` : 'Seleccione un alcance'}</strong></div>
        </> : <>
          <div className="lift-fields"><div className="form-group"><label htmlFor="lift-manual-model">Modelo de grúa</label><input id="lift-manual-model" value={input.craneModel} onChange={(event) => change('craneModel', event.target.value)} placeholder="Marca y modelo exactos" /></div><div className="form-group"><label htmlFor="lift-config">Configuración de la tabla</label><input id="lift-config" value={input.configuration} onChange={(event) => change('configuration', event.target.value)} placeholder="Estabilizadores, sector de giro, jib…" /></div>{field('boom', 'Largo de pluma (m)', 'Longitud correspondiente a la tabla de la grúa.')}{field('radius', 'Radio de trabajo (m)', 'Distancia horizontal desde el eje de giro hasta la carga.')}{field('craneCapacity', 'Capacidad bruta de la tabla (kg)', 'Copie la capacidad para esta longitud, radio y configuración.')}</div>
        </>}
        <p className="lift-hint">La capacidad se toma directamente del punto seleccionado. En modo manual, ingrese la capacidad bruta de tabla y sus deducciones.</p>
      </Step>
      <Step number="04" title="¿Cuánto pesa la carga?">
        {field('load', 'Peso de la carga (kg)', 'Ingrese el peso conocido o el obtenido en Cálculo de peso.', 'Ej.: 2500')}
        <details className="lift-accessories"><summary>Peso de accesorios y deducciones</summary><p className="lift-hint">Incluya todos los pesos indicados por la tabla. No cuente el mismo accesorio dos veces. Cero significa que verificó que no aplica.</p><div className="lift-fields">{field('belowAccessories', 'Accesorios soportados por las eslingas (kg)', 'Por ejemplo, un accesorio situado entre las eslingas y la carga.')}{field('craneAccessories', 'Otras deducciones de la grúa (kg)', 'Gancho, aparejos y accesorios que la tabla exige descontar, sin repetir el campo anterior.')}</div></details>
        <button className="lift-calculate" type="submit">Evaluar capacidad del izaje</button>
      </Step>
    </form>
    <section className={`card lift-result ${evaluated && ready ? result.status : ''}`} aria-live="polite" aria-atomic="true">
      <span className="weight-output-eyebrow">Resultado de capacidad</span>
      <h3>{!evaluated ? 'Complete los datos y evalúe' : result.status === 'within' ? 'Dentro de las capacidades ingresadas' : result.status === 'exceeded' ? 'No cumple la capacidad' : 'Pendiente de verificar'}</h3>
      {evaluated && !ready && <><p>Complete o corrija los siguientes datos:</p><ul>{[...Object.values(result.errors), ...result.missing].map((message, index) => <li key={index}>{message}</li>)}</ul></>}
      {evaluated && ready && <>
        <div className="lift-result-grid">{[['Eslingas', result.slingsPass, result.slingLoad, result.slingCapacity, result.slingUse], ['Grúa', result.cranePass, result.craneLoad, result.craneCapacity, result.craneUse]].map(([title, passes, demand, capacity, use]) => <article key={title} className={`lift-result-system ${passes ? 'pass' : 'fail'}`}><div><strong>{title}</strong><span>{passes ? 'Cumple capacidad' : 'Capacidad excedida'}</span></div><p><strong>{format(demand)} kg</strong> / {format(capacity)} kg</p><meter min="0" max="100" value={Math.min(100, use)} aria-label={`Uso de capacidad de ${title.toLowerCase()}`} /><small>Uso: {format(use)} %</small></article>)}</div>
        <dl className="weight-breakdown"><div><dt>Peso máximo de carga con estos datos</dt><dd>{format(result.allowablePayload)} kg</dd></div><div><dt>Elemento que limita</dt><dd>{result.limiting}</dd></div><div><dt>Eslingas consideradas trabajando</dt><dd>{result.effectiveCount} de {input.count}</dd></div><div><dt>Carga repartida por eslinga considerada</dt><dd>{format(result.perSlingLoad)} kg</dd></div><div><dt>Capacidad por eslinga con el ángulo</dt><dd>{format(result.perSlingCapacity)} kg</dd></div><div><dt>Ángulo desde la horizontal</dt><dd>{format(result.angle)}°</dd></div></dl>
      </>}
      <p className="lift-hint">Evaluación de capacidad para carga estática y equilibrada. El resultado no autoriza la maniobra: deben verificarse el equipo, puntos de izaje, estabilidad, entorno y plan de trabajo.</p>
    </section>
  </section>;
}
