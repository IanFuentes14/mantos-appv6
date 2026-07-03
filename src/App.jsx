import { useEffect, useMemo, useState } from 'react';
import { glossaryTerms } from './data/glossary';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  addQueuedMeasurement,
  dataUrlToBlob,
  fileToDataUrl,
  getOperatorName,
  getQueuedDocuments,
  getQueuedMeasurements,
  saveQueuedDocuments,
  saveQueuedMeasurements,
  setOperatorName,
} from './lib/offlineStore';

const DOCUMENT_BUCKET = 'conduction-documents';

const initialMeasurement = {
  pile: '',
  phase: '',
  module: '',
  panel: '',
  sample1: '',
  sample2: '',
  sample3: '',
  observation: '',
};

const statusOptions = ['Pendiente', 'En revisión', 'Aprobado', 'Observado'];

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function buildMeasurementPayload(record) {
  return {
    operator_name: record.operatorName,
    pile: record.pile,
    phase: record.phase,
    module: record.module,
    panel: record.panel || null,
    sample_1_ml: record.sample1,
    sample_2_ml: record.sample2,
    sample_3_ml: record.sample3,
    total_volume_ml: record.totalVolume,
    average_volume_ml: record.averageVolume,
    irrigation_rate_lh: record.irrigationRate,
    observation: record.observation || null,
    measured_at: record.createdAt,
  };
}

function App() {
  const [operator, setOperator] = useState(getOperatorName());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [session, setSession] = useState(null);
  const [screen, setScreen] = useState(operator ? 'menu' : 'login');
  const [measurement, setMeasurement] = useState(initialMeasurement);
  const [measurements, setMeasurements] = useState(getQueuedMeasurements());
  const [documents, setDocuments] = useState(getQueuedDocuments());
  const [documentStatus, setDocumentStatus] = useState('Pendiente');
  const [documentFiles, setDocumentFiles] = useState([]);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminMeasurements, setAdminMeasurements] = useState([]);
  const [adminDocuments, setAdminDocuments] = useState([]);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);

  const canUseSupabase = isSupabaseConfigured && supabase;
  const pendingCount = useMemo(
    () => measurements.filter((item) => item.syncStatus !== 'synced').length + documents.filter((item) => item.syncStatus !== 'synced').length,
    [measurements, documents],
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!canUseSupabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, [canUseSupabase]);

  useEffect(() => {
    if (session && screen === 'admin') loadAdminData();
  }, [session, screen]);

  useEffect(() => {
    if (isOnline && canUseSupabase && pendingCount > 0 && !syncing) syncPending();
  }, [isOnline]);

  async function syncPending() {
    if (!canUseSupabase) {
      setMessage('Configure Supabase para sincronizar datos.');
      return;
    }
    if (!navigator.onLine) {
      setMessage('Sin conexión. Los registros permanecerán en el dispositivo.');
      return;
    }

    setSyncing(true);
    try {
      const nextMeasurements = [];
      for (const record of measurements) {
        if (record.syncStatus === 'synced') {
          nextMeasurements.push(record);
          continue;
        }
        const { error } = await supabase.from('irrigation_measurements').insert(buildMeasurementPayload(record));
        nextMeasurements.push(error ? { ...record, syncStatus: 'pending', syncError: error.message } : { ...record, syncStatus: 'synced', syncError: '' });
      }

      const nextDocuments = [];
      for (const record of documents) {
        if (record.syncStatus === 'synced') {
          nextDocuments.push(record);
          continue;
        }
        const blob = dataUrlToBlob(record.dataUrl);
        const storagePath = `${record.driverName || 'sin-conductor'}/${record.createdAt.slice(0, 10)}/${record.id}-${record.fileName}`;
        const upload = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, blob, {
          contentType: record.mimeType,
          upsert: true,
        });
        if (upload.error) {
          nextDocuments.push({ ...record, syncStatus: 'pending', syncError: upload.error.message });
          continue;
        }
        const insert = await supabase.from('conduction_documents').insert({
          driver_name: record.driverName,
          operator_name: record.operatorName,
          status: record.status,
          file_name: record.fileName,
          file_path: storagePath,
          uploaded_at: record.createdAt,
        });
        nextDocuments.push(insert.error ? { ...record, syncStatus: 'pending', syncError: insert.error.message } : { ...record, syncStatus: 'synced', syncError: '' });
      }

      setMeasurements(nextMeasurements);
      setDocuments(nextDocuments);
      saveQueuedMeasurements(nextMeasurements);
      saveQueuedDocuments(nextDocuments);
      setMessage('Sincronización finalizada.');
    } finally {
      setSyncing(false);
    }
  }

  async function loadAdminData() {
    if (!session || !canUseSupabase) return;
    const [measurementResult, documentResult] = await Promise.all([
      supabase.from('irrigation_measurements').select('*').order('measured_at', { ascending: false }).limit(200),
      supabase.from('conduction_documents').select('*').order('uploaded_at', { ascending: false }).limit(200),
    ]);
    if (!measurementResult.error) setAdminMeasurements(measurementResult.data || []);
    if (!documentResult.error) {
      const rows = await Promise.all(
        (documentResult.data || []).map(async (doc) => {
          const signed = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.file_path, 60 * 10);
          return { ...doc, signedUrl: signed.data?.signedUrl || '' };
        }),
      );
      setAdminDocuments(rows);
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    if (!canUseSupabase) {
      setMessage('Configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    setMessage(error ? error.message : 'Ingreso administrativo correcto.');
  }

  async function handleAdminLogout() {
    if (canUseSupabase) await supabase.auth.signOut();
    setSession(null);
  }

  function enterOffline(event) {
    event.preventDefault();
    if (!operator.trim()) {
      setMessage('Ingrese el nombre del operador.');
      return;
    }
    setOperatorName(operator.trim());
    setScreen('menu');
  }

  function calculateMeasurement(values) {
    const samples = [values.sample1, values.sample2, values.sample3].filter((value) => value !== '').map(Number);
    const totalVolume = samples.reduce((sum, value) => sum + value, 0);
    const averageVolume = samples.length ? totalVolume / samples.length : 0;
    const irrigationRate = averageVolume * 0.4;
    return { samples, totalVolume, averageVolume, irrigationRate };
  }

  function saveMeasurement(event) {
    event.preventDefault();
    const calc = calculateMeasurement(measurement);
    if (!measurement.pile || !measurement.phase || !measurement.module || calc.samples.length === 0) {
      setMessage('Complete pila, fase, módulo y al menos un punto de volumen.');
      return;
    }
    if (calc.irrigationRate === 0 && !measurement.observation.trim()) {
      setMessage('Indique una observación cuando la tasa sea igual a 0.');
      return;
    }
    const record = {
      id: createId(),
      operatorName: operator,
      pile: measurement.pile,
      phase: measurement.phase,
      module: measurement.module,
      panel: measurement.panel,
      sample1: Number(measurement.sample1 || 0),
      sample2: Number(measurement.sample2 || 0),
      sample3: Number(measurement.sample3 || 0),
      totalVolume: Number(calc.totalVolume.toFixed(2)),
      averageVolume: Number(calc.averageVolume.toFixed(2)),
      irrigationRate: Number(calc.irrigationRate.toFixed(2)),
      observation: measurement.observation,
      createdAt: nowIso(),
      syncStatus: 'pending',
      syncError: '',
    };
    const next = addQueuedMeasurement(record);
    setMeasurements(next);
    setMeasurement(initialMeasurement);
    setMessage('Medición guardada en el dispositivo.');
  }

  async function saveDocuments(event) {
    event.preventDefault();
    if (!documentFiles.length) {
      setMessage('Seleccione al menos una imagen.');
      return;
    }
    const created = [];
    for (const file of documentFiles) {
      const dataUrl = await fileToDataUrl(file);
      created.push({
        id: createId(),
        driverName: operator,
        operatorName: operator,
        status: documentStatus,
        fileName: file.name || 'documento.jpg',
        mimeType: file.type || 'image/jpeg',
        dataUrl,
        createdAt: nowIso(),
        syncStatus: 'pending',
        syncError: '',
      });
    }
    const next = [...created, ...getQueuedDocuments()];
    saveQueuedDocuments(next);
    setDocuments(next);
    setDocumentFiles([]);
    setMessage('Documentación guardada localmente.');
  }

  async function updateAdminDocumentStatus(id, status) {
    if (!session || !canUseSupabase) return;
    const { error } = await supabase.from('conduction_documents').update({ status }).eq('id', id);
    setMessage(error ? error.message : 'Estatus actualizado.');
    if (!error) loadAdminData();
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-mantos-navy px-4 py-4 text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-blue-200">Mantos App</p>
            <h1 className="text-lg font-bold">Tasa de Riego y Conducción</h1>
          </div>
          <div className="text-right text-xs">
            <p>{isOnline ? 'Con conexión' : 'Sin conexión'}</p>
            <p>{pendingCount} pendiente(s)</p>
          </div>
        </div>
      </header>

      {message && (
        <div className="mx-auto mt-4 max-w-5xl px-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-mantos-navy">{message}</div>
        </div>
      )}

      {screen === 'login' && (
        <section className="mx-auto max-w-md px-4 py-8">
          <div className="rounded-xl bg-white p-5 shadow">
            <h2 className="text-lg font-bold text-mantos-ink">Acceso operativo</h2>
            <p className="mt-1 text-sm text-slate-500">Ingrese el operador para utilizar la app en terreno. Funciona sin conexión.</p>
            <form className="mt-5 space-y-3" onSubmit={enterOffline}>
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Operador o conductor</label>
              <input
                value={operator}
                onChange={(event) => setOperator(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-mantos-blue"
                placeholder="Nombre del operador"
              />
              <button className="w-full rounded-lg bg-mantos-blue px-4 py-3 font-bold text-white" type="submit">
                Ingresar a modo operativo
              </button>
            </form>
            <button className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-3 font-bold text-slate-700" type="button" onClick={() => setScreen('admin')}>
              Panel administrador
            </button>
          </div>
        </section>
      )}

      {screen !== 'login' && (
        <div className="mx-auto max-w-5xl px-4 py-4">
          <nav className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <NavButton active={screen === 'menu'} onClick={() => setScreen('menu')}>Inicio</NavButton>
            <NavButton active={screen === 'measurement'} onClick={() => setScreen('measurement')}>Medición</NavButton>
            <NavButton active={screen === 'conduction'} onClick={() => setScreen('conduction')}>Conducción</NavButton>
            <NavButton active={screen === 'glossary'} onClick={() => setScreen('glossary')}>Glosario</NavButton>
            <NavButton active={screen === 'admin'} onClick={() => setScreen('admin')}>Admin</NavButton>
          </nav>
        </div>
      )}

      {screen === 'menu' && (
        <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-10 md:grid-cols-3">
          <DashboardCard title="Medición" value={`${measurements.length} registro(s)`} text="Registro de tasa de riego con cola offline." />
          <DashboardCard title="Conducción" value={`${documents.length} documento(s)`} text="Carga de documentación con estatus operativo." />
          <DashboardCard title="Sincronización" value={`${pendingCount} pendiente(s)`} text="Enviar registros a Supabase cuando exista señal." />
          <button className="rounded-xl bg-mantos-navy px-4 py-4 font-bold text-white md:col-span-3" type="button" onClick={syncPending} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Sincronizar datos pendientes'}
          </button>
        </section>
      )}

      {screen === 'measurement' && (
        <section className="mx-auto max-w-3xl px-4 pb-10">
          <form className="rounded-xl bg-white p-5 shadow" onSubmit={saveMeasurement}>
            <SectionTitle title="Registro de tasa de riego" subtitle="Los datos quedan guardados localmente y se sincronizan cuando exista conexión." />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Pila" value={measurement.pile} onChange={(value) => setMeasurement({ ...measurement, pile: value })} />
              <Field label="Fase" value={measurement.phase} onChange={(value) => setMeasurement({ ...measurement, phase: value })} />
              <Field label="Módulo" value={measurement.module} onChange={(value) => setMeasurement({ ...measurement, module: value })} />
              <Field label="Paño" value={measurement.panel} onChange={(value) => setMeasurement({ ...measurement, panel: value })} />
              <Field label="Punto 1 (mL)" type="number" value={measurement.sample1} onChange={(value) => setMeasurement({ ...measurement, sample1: value })} />
              <Field label="Punto 2 (mL)" type="number" value={measurement.sample2} onChange={(value) => setMeasurement({ ...measurement, sample2: value })} />
              <Field label="Punto 3 (mL)" type="number" value={measurement.sample3} onChange={(value) => setMeasurement({ ...measurement, sample3: value })} />
            </div>
            <textarea
              value={measurement.observation}
              onChange={(event) => setMeasurement({ ...measurement, observation: event.target.value })}
              className="mt-3 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-mantos-blue"
              placeholder="Observación operacional"
            />
            <MeasurementPreview measurement={measurement} />
            <button className="mt-4 w-full rounded-lg bg-mantos-blue px-4 py-3 font-bold text-white" type="submit">
              Guardar medición
            </button>
          </form>
        </section>
      )}

      {screen === 'conduction' && (
        <section className="mx-auto max-w-3xl px-4 pb-10">
          <form className="rounded-xl bg-white p-5 shadow" onSubmit={saveDocuments}>
            <SectionTitle title="Conducción" subtitle="Carga documentación operacional y define su estatus inicial." />
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Estatus</label>
            <select
              value={documentStatus}
              onChange={(event) => setDocumentStatus(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-mantos-blue"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <label className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <span className="text-sm font-bold text-mantos-navy">Cargar documentación</span>
              <span className="mt-1 text-xs text-slate-500">Seleccione una o más imágenes. Se guardan offline hasta sincronizar.</span>
              <input
                className="hidden"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setDocumentFiles(Array.from(event.target.files || []))}
              />
            </label>
            {documentFiles.length > 0 && <p className="mt-2 text-sm text-slate-500">{documentFiles.length} archivo(s) seleccionado(s).</p>}
            <button className="mt-4 w-full rounded-lg bg-mantos-blue px-4 py-3 font-bold text-white" type="submit">
              Guardar documentación
            </button>
          </form>
          <LocalDocuments documents={documents} />
        </section>
      )}

      {screen === 'glossary' && <Glossary />}

      {screen === 'admin' && (
        <AdminPanel
          canUseSupabase={canUseSupabase}
          session={session}
          adminEmail={adminEmail}
          adminPassword={adminPassword}
          setAdminEmail={setAdminEmail}
          setAdminPassword={setAdminPassword}
          onLogin={handleAdminLogin}
          onLogout={handleAdminLogout}
          onRefresh={loadAdminData}
          measurements={adminMeasurements}
          documents={adminDocuments}
          onStatusChange={updateAdminDocumentStatus}
        />
      )}
    </main>
  );
}

function NavButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-3 text-sm font-bold ${active ? 'bg-mantos-navy text-white' : 'bg-white text-slate-700 shadow'}`}
    >
      {children}
    </button>
  );
}

function DashboardCard({ title, value, text }) {
  return (
    <article className="rounded-xl bg-white p-5 shadow">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-black text-mantos-navy">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{text}</p>
    </article>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-black text-mantos-ink">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-mantos-blue"
      />
    </label>
  );
}

function MeasurementPreview({ measurement }) {
  const { totalVolume, averageVolume, irrigationRate } = calculatePreview(measurement);
  return (
    <div className="mt-4 rounded-xl bg-mantos-pale p-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <PreviewItem label="Total" value={`${totalVolume.toFixed(2)} mL`} />
        <PreviewItem label="Promedio" value={`${averageVolume.toFixed(2)} mL`} />
        <PreviewItem label="Tasa" value={`${irrigationRate.toFixed(2)} L/h`} />
      </div>
    </div>
  );
}

function calculatePreview(values) {
  const samples = [values.sample1, values.sample2, values.sample3].filter((value) => value !== '').map(Number);
  const totalVolume = samples.reduce((sum, value) => sum + value, 0);
  const averageVolume = samples.length ? totalVolume / samples.length : 0;
  return { totalVolume, averageVolume, irrigationRate: averageVolume * 0.4 };
}

function PreviewItem({ label, value }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-black text-mantos-navy">{value}</p>
    </div>
  );
}

function LocalDocuments({ documents }) {
  if (!documents.length) return null;
  return (
    <div className="mt-5 rounded-xl bg-white p-5 shadow">
      <SectionTitle title="Documentación local" subtitle="Historial del dispositivo." />
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map((doc) => (
          <article key={doc.id} className="rounded-lg border border-slate-200 p-3">
            <img src={doc.dataUrl} alt={doc.fileName} className="h-32 w-full rounded-lg object-cover" />
            <p className="mt-2 text-sm font-bold text-mantos-navy">{doc.fileName}</p>
            <p className="text-xs text-slate-500">{doc.status} · {doc.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Glossary() {
  const [mode, setMode] = useState('list');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const terms = glossaryTerms.filter((term) => `${term.title} ${term.category} ${term.definition}`.toLowerCase().includes(query.toLowerCase()));
  const current = terms[index] || terms[0];

  function next(delta) {
    if (!terms.length) return;
    setIndex((index + delta + terms.length) % terms.length);
    setRevealed(false);
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pb-10">
      <div className="rounded-xl bg-white p-5 shadow">
        <SectionTitle title="Glosario técnico" subtitle="Consulta conceptos o utiliza el modo de prueba." />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
            setRevealed(false);
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-mantos-blue"
          placeholder="Buscar término"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className={`rounded-lg px-3 py-3 font-bold ${mode === 'list' ? 'bg-mantos-navy text-white' : 'bg-slate-100 text-slate-700'}`} type="button" onClick={() => setMode('list')}>
            Listado
          </button>
          <button className={`rounded-lg px-3 py-3 font-bold ${mode === 'quiz' ? 'bg-mantos-navy text-white' : 'bg-slate-100 text-slate-700'}`} type="button" onClick={() => setMode('quiz')}>
            Prueba
          </button>
        </div>
      </div>

      {mode === 'list' && (
        <div className="mt-4 space-y-3">
          {terms.map((term) => (
            <details key={term.id} className="rounded-xl bg-white p-4 shadow">
              <summary className="cursor-pointer font-bold text-mantos-navy">{term.title}</summary>
              <p className="mt-3 text-sm leading-6 text-slate-600">{term.definition}</p>
              <span className="mt-3 inline-block rounded-full bg-mantos-pale px-3 py-1 text-xs font-bold text-mantos-blue">{term.category}</span>
            </details>
          ))}
        </div>
      )}

      {mode === 'quiz' && current && (
        <div className="mt-4">
          <button className="w-full rounded-xl bg-white p-6 text-left shadow" type="button" onClick={() => setRevealed(true)}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Término {index + 1} de {terms.length}</p>
            <p className="mt-2 text-2xl font-black text-mantos-navy">{current.title}</p>
            {revealed ? <p className="mt-4 border-t border-slate-200 pt-4 text-sm leading-6 text-slate-600">{current.definition}</p> : <p className="mt-4 text-sm text-slate-500">Presione la tarjeta para revelar la respuesta.</p>}
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="rounded-lg bg-white px-3 py-3 font-bold text-slate-700 shadow" type="button" onClick={() => next(-1)}>Anterior</button>
            <button className="rounded-lg bg-white px-3 py-3 font-bold text-slate-700 shadow" type="button" onClick={() => next(1)}>Siguiente</button>
          </div>
        </div>
      )}
    </section>
  );
}

function AdminPanel({ canUseSupabase, session, adminEmail, adminPassword, setAdminEmail, setAdminPassword, onLogin, onLogout, onRefresh, measurements, documents, onStatusChange }) {
  return (
    <section className="mx-auto max-w-5xl px-4 pb-10">
      {!session && (
        <form className="mx-auto max-w-md rounded-xl bg-white p-5 shadow" onSubmit={onLogin}>
          <SectionTitle title="Panel administrador" subtitle="Acceso protegido mediante Supabase Auth." />
          {!canUseSupabase && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Configure las variables de entorno de Supabase para habilitar el login.</p>}
          <Field label="Correo" type="email" value={adminEmail} onChange={setAdminEmail} />
          <div className="mt-3">
            <Field label="Contraseña" type="password" value={adminPassword} onChange={setAdminPassword} />
          </div>
          <button className="mt-4 w-full rounded-lg bg-mantos-blue px-4 py-3 font-bold text-white" type="submit">Ingresar</button>
        </form>
      )}

      {session && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 shadow">
            <div>
              <h2 className="text-lg font-black text-mantos-ink">Panel administrador</h2>
              <p className="text-sm text-slate-500">{session.user.email}</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg bg-mantos-blue px-4 py-3 font-bold text-white" type="button" onClick={onRefresh}>Actualizar</button>
              <button className="rounded-lg border border-slate-300 px-4 py-3 font-bold text-slate-700" type="button" onClick={onLogout}>Salir</button>
            </div>
          </div>
          <AdminMeasurements rows={measurements} />
          <AdminDocuments rows={documents} onStatusChange={onStatusChange} />
        </div>
      )}
    </section>
  );
}

function AdminMeasurements({ rows }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow">
      <SectionTitle title="Historial de tasas de riego" subtitle="Registros sincronizados desde terreno." />
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Operador</th>
              <th className="py-2 pr-4">Ubicación</th>
              <th className="py-2 pr-4">Tasa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">{formatDate(row.measured_at)}</td>
                <td className="py-2 pr-4">{row.operator_name}</td>
                <td className="py-2 pr-4">Pila {row.pile} · Fase {row.phase} · Módulo {row.module}</td>
                <td className="py-2 pr-4 font-bold text-mantos-navy">{row.irrigation_rate_lh} L/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminDocuments({ rows, onStatusChange }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow">
      <SectionTitle title="Documentación de conducción" subtitle="Conductores, fecha de carga y estatus documental." />
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((doc) => (
          <article key={doc.id} className="rounded-xl border border-slate-200 p-3">
            {doc.signedUrl ? <img src={doc.signedUrl} alt={doc.file_name} className="h-40 w-full rounded-lg object-cover" /> : null}
            <p className="mt-3 font-bold text-mantos-navy">{doc.driver_name}</p>
            <p className="text-xs text-slate-500">{formatDate(doc.uploaded_at)} · {doc.file_name}</p>
            <select className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" value={doc.status} onChange={(event) => onStatusChange(doc.id, event.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </article>
        ))}
      </div>
    </div>
  );
}

export default App;
