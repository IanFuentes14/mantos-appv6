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

function initials(value) {
  return (value || 'OP')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0])
    .join('')
    .toUpperCase();
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

function calculateMeasurement(values) {
  const samples = [values.sample1, values.sample2, values.sample3].filter((value) => value !== '').map(Number);
  const totalVolume = samples.reduce((sum, value) => sum + value, 0);
  const averageVolume = samples.length ? totalVolume / samples.length : 0;
  const irrigationRate = averageVolume * 0.4;
  return { samples, totalVolume, averageVolume, irrigationRate };
}

function App() {
  const [operator, setOperator] = useState(getOperatorName());
  const [accessRole, setAccessRole] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [session, setSession] = useState(null);
  const [screen, setScreen] = useState('login');
  const [measurementTab, setMeasurementTab] = useState('form');
  const [measurement, setMeasurement] = useState(initialMeasurement);
  const [measurements, setMeasurements] = useState(getQueuedMeasurements());
  const [documents, setDocuments] = useState(getQueuedDocuments());
  const [documentFiles, setDocumentFiles] = useState([]);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminMeasurements, setAdminMeasurements] = useState([]);
  const [adminDocuments, setAdminDocuments] = useState([]);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('mantos_theme') || 'light');

  const canUseSupabase = isSupabaseConfigured && supabase;
  const activeOperator = accessRole === 'admin' ? 'Administrador' : operator;
  const pendingCount = useMemo(
    () => measurements.filter((item) => item.syncStatus !== 'synced').length + documents.filter((item) => item.syncStatus !== 'synced').length,
    [measurements, documents],
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mantos_theme', theme);
  }, [theme]);

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
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Ingreso administrativo correcto.');
    setAccessRole('admin');
    setScreen('menu');
  }

  async function handleAdminLogout() {
    if (canUseSupabase) await supabase.auth.signOut();
    setSession(null);
    setAccessRole(null);
    setScreen('login');
  }

  function enterOffline(event) {
    event.preventDefault();
    if (!operator.trim()) {
      setMessage('Ingrese el nombre del operador.');
      return;
    }
    setOperatorName(operator.trim());
    setAccessRole('user');
    setScreen('menu');
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
      operatorName: activeOperator,
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
    setMeasurementTab('records');
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
        driverName: activeOperator,
        operatorName: activeOperator,
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

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  return (
    <main className="app-shell">
      {message && <div className="toast show">{message}</div>}

      {screen === 'login' && (
        <LoginScreen
          operator={operator}
          setOperator={setOperator}
          onSubmit={enterOffline}
          adminEmail={adminEmail}
          adminPassword={adminPassword}
          setAdminEmail={setAdminEmail}
          setAdminPassword={setAdminPassword}
          onAdminLogin={handleAdminLogin}
          canUseSupabase={canUseSupabase}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}

      {screen === 'menu' && (
        <MenuScreen
          operator={activeOperator}
          accessRole={accessRole}
          pendingCount={pendingCount}
          isOnline={isOnline}
          syncing={syncing}
          measurements={measurements}
          documents={documents}
          onNavigate={setScreen}
          onSync={syncPending}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}

      {screen === 'measurement' && (
        <MeasurementScreen
          operator={activeOperator}
          pendingCount={pendingCount}
          isOnline={isOnline}
          measurement={measurement}
          setMeasurement={setMeasurement}
          tab={measurementTab}
          setTab={setMeasurementTab}
          records={measurements}
          onBack={() => setScreen('menu')}
          onSubmit={saveMeasurement}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}

      {screen === 'conduction' && (
        <ConductionScreen
          operator={activeOperator}
          pendingCount={pendingCount}
          isOnline={isOnline}
          documents={documents}
          files={documentFiles}
          setFiles={setDocumentFiles}
          onBack={() => setScreen('menu')}
          onSubmit={saveDocuments}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}

      {screen === 'glossary' && (
        <GlossaryScreen
          operator={activeOperator}
          pendingCount={pendingCount}
          isOnline={isOnline}
          onBack={() => setScreen('menu')}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}

      {screen === 'admin' && accessRole === 'admin' && (
        <AdminScreen
          operator={activeOperator}
          pendingCount={pendingCount}
          isOnline={isOnline}
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
          onBack={() => setScreen(accessRole === 'admin' ? 'menu' : 'login')}
          onTheme={toggleTheme}
          theme={theme}
        />
      )}
    </main>
  );
}

function LoginScreen({
  operator,
  setOperator,
  onSubmit,
  adminEmail,
  adminPassword,
  setAdminEmail,
  setAdminPassword,
  onAdminLogin,
  canUseSupabase,
  onTheme,
  theme,
}) {
  const [mode, setMode] = useState('choice');

  return (
    <section id="login-screen">
      <div className="login-welcome">
        <h1>Bienvenido</h1>
        <p>Seleccione el tipo de acceso para continuar con Mantos App.</p>
      </div>
      <div className="login-logo-wrap">
        <div className="logo-fallback">MG</div>
      </div>
      <div className="login-divider" />
      <div className="login-brand">
        <div className="login-company-name">Mantos Group</div>
        <div className="login-app-title">Medición de Tasa de Riego</div>
      </div>

      {mode === 'choice' && (
        <div className="login-card access-card">
          <button className="btn-login access-button" type="button" onClick={() => setMode('admin')}>Acceder como administrador</button>
          <button className="btn-login access-button secondary-gradient" type="button" onClick={() => setMode('user')}>Acceder como usuario</button>
          <button className="theme-toggle login-theme-toggle" type="button" onClick={onTheme}>
            <span className="theme-toggle-mark" />
            {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>
        </div>
      )}

      {mode === 'admin' && (
        <form className="login-card" onSubmit={onAdminLogin}>
          <div className="login-form-title">Acceso administrador</div>
          {!canUseSupabase && <p className="admin-warning">Configure Supabase para habilitar el login administrativo.</p>}
          <label htmlFor="login-admin-email">Correo</label>
          <input id="login-admin-email" type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="admin@mantos.app" />
          <label htmlFor="login-admin-password">Contraseña</label>
          <input id="login-admin-password" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Contraseña" />
          <button className="btn-login" type="submit">Ingresar al panel</button>
          <button className="btn-secondary admin-login-button" type="button" onClick={() => setMode('choice')}>Volver</button>
        </form>
      )}

      {mode === 'user' && (
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-form-title">Acceso usuario</div>
        <label htmlFor="operator-name">Operador o conductor</label>
        <input id="operator-name" type="text" value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="Nombre del operador" />
        <button className="btn-login" type="submit">Ingresar como usuario</button>
        <button className="btn-secondary admin-login-button" type="button" onClick={() => setMode('choice')}>Volver</button>
        <button className="theme-toggle login-theme-toggle" type="button" onClick={onTheme}>
          <span className="theme-toggle-mark" />
          {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>
        <p className="login-hint">Los registros quedan disponibles sin conexión y se sincronizan al recuperar señal.</p>
      </form>
      )}
    </section>
  );
}

function Header({ title, operator, pendingCount, isOnline, onBack, onTheme, theme }) {
  return (
    <header className="app-header">
      <div className="header-top">
        {onBack ? <button className="btn-back" type="button" onClick={onBack}>Volver al menú</button> : <div className="header-logo-text">MantosGroup</div>}
        <div className="header-right">
          <span className="header-subtitle">{title}</span>
          <div className="header-actions">
            <button className="theme-toggle" type="button" onClick={onTheme} aria-pressed={theme === 'dark'}>
              <span className="theme-toggle-mark" />
              {theme === 'dark' ? 'Claro' : 'Oscuro'}
            </button>
            <div className="user-badge">
              <span className="user-avatar">{initials(operator)}</span>
              <span>{operator || 'Operador'}</span>
            </div>
          </div>
          <span className="header-subtitle">{isOnline ? 'Con conexión' : 'Sin conexión'} · {pendingCount} pendiente(s)</span>
        </div>
      </div>
    </header>
  );
}

function MenuScreen({ operator, accessRole, pendingCount, isOnline, syncing, measurements, documents, onNavigate, onSync, onTheme, theme }) {
  return (
    <section id="menu-screen">
      <Header title="Menú principal" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onTheme={onTheme} theme={theme} />
      <div className="menu-welcome">
        <p>Bienvenido, {operator}</p>
        <span>Seleccione el módulo de trabajo.</span>
      </div>
      <div className="menu-list">
        <MenuCard icon="TR" title="Medición Tasa de Riego" desc={`${measurements.length} registro(s) locales. Calcule y guarde mediciones de terreno.`} onClick={() => onNavigate('measurement')} />
        <MenuCard icon="GT" title="Glosario de Términos" desc="Consulte definiciones y utilice el modo de prueba." alt onClick={() => onNavigate('glossary')} />
        <MenuCard icon="DC" title="Conducción" desc={`${documents.length} documento(s) locales. Cargue imágenes de documentación operacional.`} brown onClick={() => onNavigate('conduction')} />
        {accessRole === 'admin' && (
          <MenuCard icon="AD" title="Panel administrador" desc="Revise historial de tasas de riego y documentación sincronizada." onClick={() => onNavigate('admin')} />
        )}
        <button className="btn-save menu-sync" type="button" onClick={onSync} disabled={syncing}>
          {syncing ? 'Sincronizando...' : `Sincronizar datos pendientes (${pendingCount})`}
        </button>
      </div>
    </section>
  );
}

function MenuCard({ icon, title, desc, onClick, alt, brown }) {
  return (
    <button className="menu-card" type="button" onClick={onClick}>
      <div className={`menu-card-icon ${alt ? 'alt' : ''} ${brown ? 'brown' : ''}`}>{icon}</div>
      <div className="menu-card-text">
        <div className="menu-card-title">{title}</div>
        <div className="menu-card-desc">{desc}</div>
      </div>
      <div className="menu-card-arrow">›</div>
    </button>
  );
}

function MeasurementScreen({ operator, pendingCount, isOnline, measurement, setMeasurement, tab, setTab, records, onBack, onSubmit, onTheme, theme }) {
  const preview = calculateMeasurement(measurement);
  return (
    <section>
      <Header title="Tasa de Riego" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} theme={theme} />
      <div className="tabs">
        <button className={`tab ${tab === 'form' ? 'active' : ''}`} type="button" onClick={() => setTab('form')}>Formulario</button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} type="button" onClick={() => setTab('records')}>Historial</button>
      </div>
      <div className="content">
        {tab === 'form' && (
          <form onSubmit={onSubmit}>
            <div className="card">
              <div className="card-title">Identificación</div>
              <div className="form-row">
                <Field label="Pila" value={measurement.pile} onChange={(value) => setMeasurement({ ...measurement, pile: value })} />
                <Field label="Fase" value={measurement.phase} onChange={(value) => setMeasurement({ ...measurement, phase: value })} />
              </div>
              <div className="form-row">
                <Field label="Módulo" value={measurement.module} onChange={(value) => setMeasurement({ ...measurement, module: value })} />
                <Field label="Paño" value={measurement.panel} onChange={(value) => setMeasurement({ ...measurement, panel: value })} />
              </div>
            </div>

            <div className="card">
              <div className="card-title">Volumen de muestra (mL)</div>
              <div className="points-grid">
                <Field label="Punto 1" type="number" value={measurement.sample1} onChange={(value) => setMeasurement({ ...measurement, sample1: value })} />
                <Field label="Punto 2" type="number" value={measurement.sample2} onChange={(value) => setMeasurement({ ...measurement, sample2: value })} />
                <Field label="Punto 3" type="number" value={measurement.sample3} onChange={(value) => setMeasurement({ ...measurement, sample3: value })} />
              </div>
              <div className="vol-result">
                <span>Volumen total</span>
                <strong>{preview.totalVolume.toFixed(2)} mL</strong>
              </div>
            </div>

            <div className="tasa-card">
              <div>
                <div className="tasa-label">Tasa calculada</div>
                <div className="tasa-value">{preview.irrigationRate.toFixed(2)}</div>
                <div className="tasa-unit">L/h</div>
                <div className="tasa-formula">Promedio × 0,4</div>
              </div>
              <div className="tasa-icon">TR</div>
            </div>

            {preview.irrigationRate === 0 && (
              <div className="card observacion-card">
                <div className="card-title">Observación requerida: tasa de riego igual a 0</div>
                <textarea value={measurement.observation} onChange={(event) => setMeasurement({ ...measurement, observation: event.target.value })} placeholder="Ingrese observación operacional" />
              </div>
            )}

            {preview.irrigationRate !== 0 && (
              <div className="card">
                <div className="card-title">Observación operacional</div>
                <textarea value={measurement.observation} onChange={(event) => setMeasurement({ ...measurement, observation: event.target.value })} placeholder="Opcional" />
              </div>
            )}

            <button className="btn-save" type="submit">Guardar registro</button>
            <button className="btn-secondary" type="button" onClick={() => setMeasurement(initialMeasurement)}>Limpiar formulario</button>
          </form>
        )}

        {tab === 'records' && <LocalMeasurements records={records} />}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function LocalMeasurements({ records }) {
  if (!records.length) {
    return <div className="empty"><div className="empty-icon">Sin registros</div><p>No hay registros disponibles.</p></div>;
  }
  const avg = records.reduce((sum, item) => sum + Number(item.irrigationRate || 0), 0) / records.length;
  const max = Math.max(...records.map((item) => Number(item.irrigationRate || 0)));
  return (
    <>
      <div className="stats-grid">
        <Stat label="Registros" value={records.length} />
        <Stat label="Promedio" value={avg.toFixed(1)} />
        <Stat label="Máxima" value={max.toFixed(1)} />
      </div>
      {records.map((record) => (
        <article className="record-item" key={record.id}>
          <div className="rec-header">
            <div>
              <strong>Pila {record.pile} · Fase {record.phase} · Módulo {record.module}</strong>
              <p>{formatDate(record.createdAt)} · {record.operatorName}</p>
            </div>
            <span className={`sync-pill ${record.syncStatus === 'synced' ? 'synced' : ''}`}>{record.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}</span>
          </div>
          <div className="record-tasa">{record.irrigationRate} L/h</div>
          {record.observation ? <p className="record-note">{record.observation}</p> : null}
        </article>
      ))}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ConductionScreen({ operator, pendingCount, isOnline, documents, files, setFiles, onBack, onSubmit, onTheme, theme }) {
  return (
    <section>
      <Header title="Conducción" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} theme={theme} />
      <div className="content">
        <form onSubmit={onSubmit}>
          <label className="cond-upload-card" htmlFor="cond-input">
            <div className="cond-upload-icon">DC</div>
            <div className="cond-upload-title">Cargar documentación</div>
            <div className="cond-upload-desc">Seleccione una o más imágenes. Se guardan offline hasta sincronizar.</div>
            <input id="cond-input" type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} />
          </label>
          {files.length > 0 && <p className="selected-files">{files.length} archivo(s) seleccionado(s).</p>}
          <button className="btn-save" type="submit">Guardar documentación</button>
        </form>
        <LocalDocuments documents={documents} />
      </div>
    </section>
  );
}

function LocalDocuments({ documents }) {
  return (
    <div className="card">
      <div className="cond-section-title">
        <span>Documentación local</span>
        <strong>{documents.length}</strong>
      </div>
      {!documents.length && <div className="cond-empty-hint">No hay documentos cargados.</div>}
      <div className="cond-gallery">
        {documents.map((doc) => (
          <article className="cond-thumb" key={doc.id}>
            <img src={doc.dataUrl} alt={doc.fileName} />
            <div className="cond-thumb-info">
              <strong>{doc.fileName}</strong>
              <span>{formatDate(doc.createdAt)} · {doc.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function GlossaryScreen({ operator, pendingCount, isOnline, onBack, onTheme, theme }) {
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
    <section>
      <Header title="Glosario de Términos" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} theme={theme} />
      <div className="content">
        <div className="card">
          <div className="card-title">Búsqueda</div>
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
              setRevealed(false);
            }}
            placeholder="Buscar término"
          />
        </div>
        <div className="glosario-mode-tabs">
          <button className={mode === 'list' ? 'active' : ''} type="button" onClick={() => setMode('list')}>Listado</button>
          <button className={mode === 'quiz' ? 'active' : ''} type="button" onClick={() => setMode('quiz')}>Prueba</button>
        </div>

        {mode === 'list' && terms.map((term) => <TermCard key={term.id} term={term} />)}

        {mode === 'quiz' && current && (
          <>
            <button className={`quiz-card ${revealed ? 'revealed' : ''}`} type="button" onClick={() => setRevealed(true)}>
              <div className="quiz-label">Término {index + 1} de {terms.length}</div>
              <div className="quiz-title">{current.title}</div>
              {revealed ? <p className="quiz-answer">{current.definition}</p> : <p className="quiz-hint">Presione la tarjeta para revelar la respuesta.</p>}
            </button>
            <div className="quiz-actions">
              <button type="button" onClick={() => next(-1)}>Anterior</button>
              <button type="button" onClick={() => next(1)}>Siguiente</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function TermCard({ term }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`term-card ${open ? 'open' : ''}`}>
      <button className="term-card-head" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="term-card-title">{term.title}</span>
        <span className="term-card-chevron">⌄</span>
      </button>
      <div className="term-card-body">
        <div className="term-card-body-inner">
          <p>{term.definition}</p>
          <span className="term-card-cat">{term.category}</span>
        </div>
      </div>
    </article>
  );
}

function AdminScreen({
  operator,
  pendingCount,
  isOnline,
  canUseSupabase,
  session,
  adminEmail,
  adminPassword,
  setAdminEmail,
  setAdminPassword,
  onLogin,
  onLogout,
  onRefresh,
  measurements,
  documents,
  onBack,
  onTheme,
  theme,
}) {
  return (
    <section>
      <Header title="Panel administrador" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} theme={theme} />
      <div className="content">
        {!session && (
          <form className="login-card admin-card" onSubmit={onLogin}>
            <div className="card-title">Acceso protegido</div>
            {!canUseSupabase && <p className="admin-warning">Configure las variables de entorno de Supabase para habilitar el login.</p>}
            <label htmlFor="admin-email">Correo</label>
            <input id="admin-email" type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
            <label htmlFor="admin-password">Contraseña</label>
            <input id="admin-password" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
            <button className="btn-login" type="submit">Ingresar</button>
          </form>
        )}

        {session && (
          <>
            <div className="card admin-toolbar">
              <div>
                <div className="card-title">Sesión administrativa</div>
                <strong>{session.user.email}</strong>
              </div>
              <div className="admin-actions">
                <button className="btn-save compact" type="button" onClick={onRefresh}>Actualizar</button>
                <button className="btn-secondary compact" type="button" onClick={onLogout}>Salir</button>
              </div>
            </div>
            <AdminMeasurements rows={measurements} />
            <AdminDocuments rows={documents} />
          </>
        )}
      </div>
    </section>
  );
}

function AdminMeasurements({ rows }) {
  return (
    <div className="card">
      <div className="card-title">Historial de tasas de riego</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Operador</th>
              <th>Ubicación</th>
              <th>Tasa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.measured_at)}</td>
                <td>{row.operator_name}</td>
                <td>Pila {row.pile} · Fase {row.phase} · Módulo {row.module}</td>
                <td><strong>{row.irrigation_rate_lh} L/h</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminDocuments({ rows }) {
  return (
    <div className="card">
      <div className="card-title">Documentación de conducción</div>
      {!rows.length && <div className="cond-empty-hint">No hay documentos sincronizados.</div>}
      <div className="admin-doc-grid">
        {rows.map((doc) => (
          <article key={doc.id} className="admin-doc-card">
            {doc.signedUrl ? <img src={doc.signedUrl} alt={doc.file_name} /> : null}
            <strong>{doc.driver_name}</strong>
            <span>{formatDate(doc.uploaded_at)} · {doc.file_name}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

export default App;
