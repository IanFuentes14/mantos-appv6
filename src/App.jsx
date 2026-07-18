import { useEffect, useMemo, useState } from 'react';
import { glossaryTerms } from './data/glossary';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  addQueuedMeasurement,
  dataUrlToBlob,
  getQueuedDocuments,
  getQueuedMeasurements,
  saveQueuedDocuments,
  saveQueuedMeasurements,
  setOperatorName,
} from './lib/offlineStore';

const DOCUMENT_BUCKET = 'conduction-documents';
const DELETE_FUNCTION = 'delete-local-record';
const IMAGE_MAX_EDGE = 1600;
const IMAGE_QUALITY = 0.72;
const COMPRESSED_IMAGE_TYPE = 'image/jpeg';
const LIFTING_DOCUMENTATION_ITEMS = [
  'Procedimiento de trabajo',
  'Difusion de procedimiento',
  'Evaluacion de procedimiento',
  'QRA (Matriz de riesgos)',
  'Difusion de QRA',
  'Respaldo de GCOM',
  'Permisos aplicables',
  'ART',
  'Cartillas controles criticos',
  'Checklists aplicables',
  'Plan de emergencia',
  'Plan transito del area',
  'Certificaciones',
  'Documentos del camion',
];
const LIFTING_MATERIALS = [
  { name: 'PVC', density: 1400 },
  { name: 'HDPE', density: 950 },
  { name: 'Hormigon', density: 2400 },
  { name: 'Cobre', density: 8960 },
  { name: 'Acero carbono', density: 7850 },
  { name: 'Acero inox', density: 8000 },
  { name: 'Hierro', density: 7860 },
  { name: 'Plomo', density: 11340 },
];

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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const next = char === 'x' ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo procesar la imagen seleccionada.'));
    };
    image.src = url;
  });
}

async function compressImageFile(file) {
  const looksLikeImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
  if (!looksLikeImage) {
    throw new Error(`El archivo ${file.name || 'seleccionado'} no es una imagen válida.`);
  }

  const image = await loadImageFile(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(width, height));
  const nextWidth = Math.max(1, Math.round(width * scale));
  const nextHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar la compresión de imagen.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, nextWidth, nextHeight);
  context.drawImage(image, 0, 0, nextWidth, nextHeight);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, COMPRESSED_IMAGE_TYPE, IMAGE_QUALITY));
  if (!blob) throw new Error(`No se pudo comprimir ${file.name || 'la imagen'}.`);

  const cleanName = (file.name || 'documento').replace(/\.[^.]+$/, '');
  return {
    dataUrl: await blobToDataUrl(blob),
    fileName: `${cleanName}.jpg`,
    mimeType: COMPRESSED_IMAGE_TYPE,
    compressedSize: blob.size,
    originalSize: file.size,
  };
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatDateForFile(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const content = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\n');
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getMeasurementReportFilename() {
  return `tasa_riego_${formatDateForFile()}.xlsx`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function strToUtf8Bytes(value) {
  return Array.from(new TextEncoder().encode(value));
}

function u16(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  const entries = [];
  let offset = 0;
  const dosTime = 0x00;
  const dosDate = 0x21;

  files.forEach((file) => {
    const nameBytes = strToUtf8Bytes(file.name);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const localHeader = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ];
    const localEntry = [...localHeader, ...dataBytes];
    entries.push({ nameBytes, crc, size, offset });
    localParts.push(localEntry);
    offset += localEntry.length;
  });

  const centralOffsetStart = offset;
  entries.forEach((entry) => {
    centralParts.push([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(entry.crc),
      ...u32(entry.size),
      ...u32(entry.size),
      ...u16(entry.nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.offset),
      ...entry.nameBytes,
    ]);
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(centralOffsetStart),
    ...u16(0),
  ];
  return [...localParts.flat(), ...centralParts.flat(), ...eocd];
}

function xmlEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(index) {
  let label = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function buildXlsxBytes(rows, numCols, sheetName, colWidth, freezeRows) {
  const sharedStrings = [];
  const sharedIndex = {};
  const mergeCells = [];

  function sstIndex(text) {
    if (Object.prototype.hasOwnProperty.call(sharedIndex, text)) return sharedIndex[text];
    const index = sharedStrings.length;
    sharedStrings.push(text);
    sharedIndex[text] = index;
    return index;
  }

  const rowsXml = rows.map((row, rowIndex) => {
    const rowNum = rowIndex + 1;
    const cellsXml = row.map((cell, colIndex) => {
      const ref = `${colLetter(colIndex)}${rowNum}`;
      if (cell.merge && cell.merge > 1) mergeCells.push(`${ref}:${colLetter(colIndex + cell.merge - 1)}${rowNum}`);
      const text = cell.v === null || cell.v === undefined ? '' : String(cell.v);
      const styleAttr = cell.style !== undefined ? ` s="${cell.style}"` : '';
      return `<c r="${ref}" t="s"${styleAttr}><v>${sstIndex(text)}</v></c>`;
    }).join('');
    return `<row r="${rowNum}">${cellsXml}</row>`;
  }).join('');

  const dimensionRef = `A1:${colLetter(numCols - 1)}${rows.length}`;
  const pane = freezeRows > 0 ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  const cols = Array.from({ length: numCols }, (_, col) => `<col min="${col + 1}" max="${col + 1}" width="${colWidth}" customWidth="1"/>`).join('');
  const merges = mergeCells.length
    ? `<mergeCells count="${mergeCells.length}">${mergeCells.map((merge) => `<mergeCell ref="${merge}"/>`).join('')}</mergeCells>`
    : '';
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimensionRef}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${rowsXml}</sheetData>${merges}</worksheet>`;
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((item) => `<si><t xml:space="preserve">${xmlEscape(item)}</t></si>`).join('')}</sst>`;
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="14"/><b/><name val="Calibri"/></font><font><sz val="10"/><b/><name val="Calibri"/></font><font><sz val="11"/><b/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyAlignment="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';

  return buildZip([
    { name: '[Content_Types].xml', data: strToUtf8Bytes(contentTypes) },
    { name: '_rels/.rels', data: strToUtf8Bytes(rootRels) },
    { name: 'xl/workbook.xml', data: strToUtf8Bytes(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: strToUtf8Bytes(workbookRels) },
    { name: 'xl/styles.xml', data: strToUtf8Bytes(stylesXml) },
    { name: 'xl/sharedStrings.xml', data: strToUtf8Bytes(sstXml) },
    { name: 'xl/worksheets/sheet1.xml', data: strToUtf8Bytes(sheetXml) },
  ]);
}

function buildMeasurementXlsx(records) {
  const headers = ['Fecha', 'Operador', 'Pila', 'Fase', 'Módulo', 'Paño', 'Punto 1', 'Punto 2', 'Punto 3', 'Vol. Total', 'Promedio', 'Tasa (L/h)', 'Observación', 'Estado'];
  const rows = [
    [{ v: 'Mantos Group', style: 1, merge: headers.length }],
    [{ v: `Fecha: ${new Date().toLocaleDateString('es-CL')}   |   Total registros: ${records.length}`, style: 2, merge: headers.length }],
    headers.map(() => ({ v: '', style: 0 })),
    headers.map((header) => ({ v: header, style: 3 })),
  ];

  records.forEach((record) => {
    rows.push([
      formatDate(record.createdAt),
      record.operatorName || '-',
      record.pile || '-',
      record.phase || '-',
      record.module || '-',
      record.panel || '-',
      `${record.sample1 ?? 0} mL`,
      `${record.sample2 ?? 0} mL`,
      `${record.sample3 ?? 0} mL`,
      `${record.totalVolume ?? 0} mL`,
      `${record.averageVolume ?? 0} mL`,
      `${record.irrigationRate ?? 0} L/h`,
      record.observation || '-',
      record.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente',
    ].map((value) => ({ v: value, style: 0 })));
  });

  return buildXlsxBytes(rows, headers.length, 'Tasa Riego', 14, 4);
}

function normalizeAdminMeasurements(rows) {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.measured_at,
    operatorName: row.operator_name,
    pile: row.pile,
    phase: row.phase,
    module: row.module,
    panel: row.panel,
    sample1: row.sample_1_ml,
    sample2: row.sample_2_ml,
    sample3: row.sample_3_ml,
    totalVolume: row.total_volume_ml,
    averageVolume: row.average_volume_ml,
    irrigationRate: row.irrigation_rate_lh,
    observation: row.observation,
    syncStatus: 'synced',
  }));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunk));
  }
  return btoa(binary);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function shareMeasurementExcel(records) {
  const bytes = buildMeasurementXlsx(records);
  const filename = getMeasurementReportFilename();
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const capacitorPlugins = window.Capacitor?.Plugins;
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });

  if (capacitorPlugins?.Filesystem && capacitorPlugins?.Share) {
    try {
      const written = await capacitorPlugins.Filesystem.writeFile({
        path: filename,
        data: bytesToBase64(bytes),
        directory: 'CACHE',
      });
      await capacitorPlugins.Share.share({
        title: 'Reporte Tasa de Riego',
        text: `Mantos Group - ${new Date().toLocaleDateString('es-CL')}`,
        url: written.uri,
        dialogTitle: 'Compartir',
      });
      return 'Reporte compartido.';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }

  const file = new File([blob], filename, { type: mimeType });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: 'Reporte Tasa de Riego', text: 'Mantos Group', files: [file] });
      return 'Reporte compartido.';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }

  downloadBlob(blob, filename);
  return 'Reporte descargado.';
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
    id: record.id,
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
    delete_token: record.deleteToken || null,
  };
}

function getDocumentStoragePath(record) {
  if (record.filePath) return record.filePath;
  return `${record.driverName || 'sin-conductor'}/${record.createdAt.slice(0, 10)}/${record.id}-${record.fileName}`;
}

async function deleteRemoteRecord(kind, record) {
  if (!record.deleteToken) {
    throw new Error('Este registro no tiene identificador de eliminación. Sincronice nuevamente o elimínelo desde el panel administrativo.');
  }
  const { data, error } = await supabase.functions.invoke(DELETE_FUNCTION, {
    body: {
      kind,
      id: record.id,
      deleteToken: record.deleteToken,
    },
  });
  if (error) throw new Error(error.message || 'No se pudo eliminar el registro en Supabase.');
  if (!data?.ok) throw new Error(data?.error || 'No se pudo eliminar el registro en Supabase.');
}

function calculateMeasurement(values) {
  const samples = [values.sample1, values.sample2, values.sample3].filter((value) => value !== '').map(Number);
  const totalVolume = samples.reduce((sum, value) => sum + value, 0);
  const averageVolume = samples.length ? totalVolume / samples.length : 0;
  const irrigationRate = averageVolume * 0.4;
  return { samples, totalVolume, averageVolume, irrigationRate };
}

function onlyDigits(value) {
  return value.replace(/\D/g, '');
}

function onlyLettersAndNumbers(value) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizePanel(value) {
  return value.replace(/[^aAbB]/g, '').toUpperCase().slice(0, 1);
}

function toMeters(value, unit = 'm') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return unit === 'cm' ? number / 100 : number;
}

function formatWeight(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Ingrese valores';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} t`;
  return `${value.toFixed(2)} kg`;
}

function calculateSlingGeometry(peso, n, l, h) {
  if (l < h) throw new Error('La longitud de la eslinga debe ser mayor o igual a la altura.');
  return {
    angulo_grados: Math.asin(h / l) * (180 / Math.PI),
    tension_eslinga: (peso / n) * (l / h),
  };
}

function calculateCenterOfGravity(piezas) {
  let peso_total = 0;
  let suma_momentos = 0;

  for (const pieza of piezas) {
    peso_total += pieza.peso;
    suma_momentos += pieza.peso * pieza.distancia_al_punto_cero;
  }

  if (peso_total === 0) return { peso_total: 0, CG_final: 0 };

  return {
    peso_total,
    CG_final: suma_momentos / peso_total,
  };
}

function calculateBoomGeometry(longitud_pluma, radio_operacion) {
  if (longitud_pluma <= radio_operacion) throw new Error('El radio de operación debe ser menor que la longitud de pluma.');
  return {
    angulo_pluma_grados: Math.acos(radio_operacion / longitud_pluma) * (180 / Math.PI),
    altura_punta_pluma: Math.sqrt((longitud_pluma * longitud_pluma) - (radio_operacion * radio_operacion)),
  };
}

function App() {
  const [operator, setOperator] = useState('');
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

  async function ensureOperatorAuth() {
    if (!canUseSupabase || !navigator.onLine) return null;
    const current = await supabase.auth.getSession();
    if (current.data.session?.user?.is_anonymous) return current.data.session;
    if (current.data.session && accessRole !== 'admin') await supabase.auth.signOut();

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      return null;
    }
    return data.session;
  }

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
      if (accessRole !== 'admin') await ensureOperatorAuth();
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
        const storagePath = getDocumentStoragePath(record);
        const upload = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, blob, {
          contentType: record.mimeType,
          upsert: false,
        });
        if (upload.error) {
          nextDocuments.push({ ...record, syncStatus: 'pending', syncError: upload.error.message });
          continue;
        }
        const insert = await supabase.from('conduction_documents').insert({
          id: record.id,
          driver_name: record.driverName,
          operator_name: record.operatorName,
          file_name: record.fileName,
          file_path: storagePath,
          uploaded_at: record.createdAt,
          delete_token: record.deleteToken || null,
        });
        nextDocuments.push(insert.error ? { ...record, syncStatus: 'pending', syncError: insert.error.message } : { ...record, filePath: storagePath, syncStatus: 'synced', syncError: '' });
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

  async function closeSession() {
    if (accessRole === 'admin' && canUseSupabase) await supabase.auth.signOut();
    setSession(null);
    setAccessRole(null);
    setOperator('');
    setAdminEmail('');
    setAdminPassword('');
    setScreen('login');
    setMessage('Sesión cerrada.');
  }

  async function enterOffline(event) {
    event.preventDefault();
    if (!operator.trim()) {
      setMessage('Ingrese el nombre del operador.');
      return;
    }
    setOperatorName(operator.trim());
    setAccessRole('user');
    setScreen('menu');
    if (canUseSupabase && navigator.onLine) await ensureOperatorAuth();
  }

  function saveMeasurement(event) {
    event.preventDefault();
    const calc = calculateMeasurement(measurement);
    if (!measurement.pile || !measurement.phase || !measurement.module || calc.samples.length === 0) {
      setMessage('Complete pila, fase, módulo y al menos un punto de volumen.');
      return;
    }
    if (!/^\d+$/.test(measurement.pile)) {
      setMessage('El campo pila debe contener solo números.');
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(measurement.phase)) {
      setMessage('El campo fase debe contener solo letras y/o números.');
      return;
    }
    if (!/^\d+$/.test(measurement.module)) {
      setMessage('El campo módulo debe contener solo números.');
      return;
    }
    if (measurement.panel && !/^[AB]$/i.test(measurement.panel)) {
      setMessage('El campo paño solo puede ser A, B o quedar vacío.');
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
      phase: measurement.phase.toUpperCase(),
      module: measurement.module,
      panel: measurement.panel.toUpperCase(),
      sample1: Number(measurement.sample1 || 0),
      sample2: Number(measurement.sample2 || 0),
      sample3: Number(measurement.sample3 || 0),
      totalVolume: Number(calc.totalVolume.toFixed(2)),
      averageVolume: Number(calc.averageVolume.toFixed(2)),
      irrigationRate: Number(calc.irrigationRate.toFixed(2)),
      observation: measurement.observation,
      createdAt: nowIso(),
      deleteToken: createId(),
      syncStatus: 'pending',
      syncError: '',
    };
    const next = addQueuedMeasurement(record);
    setMeasurements(next);
    setMeasurement({
      ...initialMeasurement,
      pile: measurement.pile,
      phase: measurement.phase,
    });
    setMeasurementTab('records');
    setMessage('Medición guardada en el dispositivo.');
  }

  function clearMeasurementHistory() {
    setMeasurements([]);
    saveQueuedMeasurements([]);
    setMessage('Historial eliminado por completo.');
  }

  async function shareMeasurementHistory() {
    if (!measurements.length) {
      setMessage('No hay registros para exportar.');
      return;
    }
    try {
      setMessage('Generando reporte...');
      const result = await shareMeasurementExcel(measurements);
      setMessage(result);
    } catch (error) {
      if (error?.name !== 'AbortError') setMessage(error?.message || 'No se pudo compartir el reporte.');
    }
  }

  async function saveDocuments(event) {
    event.preventDefault();
    if (!documentFiles.length) {
      setMessage('Seleccione al menos una imagen.');
      return;
    }
    const created = [];
    for (const file of documentFiles) {
      const compressed = await compressImageFile(file);
      created.push({
        id: createId(),
        driverName: activeOperator,
        operatorName: activeOperator,
        fileName: compressed.fileName,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize,
        createdAt: nowIso(),
        deleteToken: createId(),
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

  async function deleteDocument(record) {
    if (!canUseSupabase || record.syncStatus !== "synced") {
      const next = documents.filter((doc) => doc.id !== record.id);
      setDocuments(next);
      saveQueuedDocuments(next);
      setMessage("Documento eliminado del dispositivo.");
      return;
    }
    if (!navigator.onLine) {
      setMessage("Se requiere conexion para eliminar un documento ya sincronizado.");
      return;
    }

    try {
      await deleteRemoteRecord("document", record);
    } catch (error) {
      setMessage(error?.message || "No se pudo eliminar el documento en Supabase.");
      return;
    }

    const next = documents.filter((doc) => doc.id !== record.id);
    setDocuments(next);
    saveQueuedDocuments(next);
    setMessage("Documento eliminado del dispositivo y de Supabase.");
  }
  async function deleteMeasurement(record) {
    if (!record) return;
    if (record.syncStatus === "synced") {
      if (!canUseSupabase || !navigator.onLine) {
        setMessage("Se requiere conexion para eliminar una medicion ya sincronizada.");
        return;
      }
      try {
        await deleteRemoteRecord("measurement", record);
      } catch (error) {
        setMessage(error?.message || "No se pudo eliminar la medicion en Supabase.");
        return;
      }
    }

    const next = measurements.filter((item) => item.id !== record.id);
    setMeasurements(next);
    saveQueuedMeasurements(next);
    setMessage(record.syncStatus === "synced" ? "Medicion eliminada del dispositivo y de Supabase." : "Medicion eliminada del dispositivo.");
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
          onLogout={closeSession}
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
          onLogout={closeSession}
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
          onClearHistory={clearMeasurementHistory}
          onDeleteRecord={deleteMeasurement}
          onShareHistory={shareMeasurementHistory}
          onBack={() => setScreen('menu')}
          onSubmit={saveMeasurement}
          onTheme={toggleTheme}
          onLogout={closeSession}
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
          onDeleteDocument={deleteDocument}
          onTheme={toggleTheme}
          onLogout={closeSession}
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
          onLogout={closeSession}
          theme={theme}
        />
      )}

      {screen === 'lifting' && (
        <LiftingScreen
          operator={activeOperator}
          pendingCount={pendingCount}
          isOnline={isOnline}
          onBack={() => setScreen('menu')}
          onTheme={toggleTheme}
          onLogout={closeSession}
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
          onLogout={closeSession}
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
        <img className="login-logo" src="/mantos_group_logo.jpg" alt="Mantos Group" />
      </div>
      <div className="login-divider" />
      <div className="login-brand">
        <div className="login-company-name">Mantos Group</div>
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

function Header({ title, operator, pendingCount, isOnline, onBack, onTheme, onLogout, theme }) {
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
            <button className="user-badge" type="button" onClick={onLogout} title="Cerrar sesión">
              <span className="user-avatar">{initials(operator)}</span>
              <span>{operator || 'Operador'}</span>
              <span className="logout-label">Cerrar sesión</span>
            </button>
          </div>
          <span className="header-subtitle">{isOnline ? 'Con conexión' : 'Sin conexión'} · {pendingCount} pendiente(s)</span>
        </div>
      </div>
    </header>
  );
}

function MenuScreen({ operator, accessRole, pendingCount, isOnline, syncing, measurements, documents, onNavigate, onSync, onTheme, onLogout, theme }) {
  return (
    <section id="menu-screen">
      <Header title="Menú principal" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onTheme={onTheme} onLogout={onLogout} theme={theme} />
      <div className="menu-welcome">
        <p>Bienvenido, {operator}</p>
        <span>Seleccione el módulo de trabajo.</span>
      </div>
      <div className="menu-list">
        <MenuCard icon="TR" title="Medición Tasa de Riego" desc={`${measurements.length} registro(s) locales. Calcule y guarde mediciones de terreno.`} onClick={() => onNavigate('measurement')} />
        <MenuCard icon="GT" title="Glosario de Términos" desc="Consulte definiciones y utilice el modo de prueba." alt onClick={() => onNavigate('glossary')} />
        <MenuCard icon="DC" title="Conducción" desc={`${documents.length} documento(s) locales. Cargue imágenes de documentación operacional.`} brown onClick={() => onNavigate('conduction')} />
        <MenuCard icon="IZ" title="Izajes" desc="Consulte formulas, calcule pesos y revise informacion operacional de izaje." lifting onClick={() => onNavigate('lifting')} />
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

function MenuCard({ icon, title, desc, onClick, alt, brown, lifting }) {
  return (
    <button className="menu-card" type="button" onClick={onClick}>
      <div className={`menu-card-icon ${alt ? 'alt' : ''} ${brown ? 'brown' : ''} ${lifting ? 'lifting' : ''}`}>{icon}</div>
      <div className="menu-card-text">
        <div className="menu-card-title">{title}</div>
        <div className="menu-card-desc">{desc}</div>
      </div>
      <div className="menu-card-arrow">›</div>
    </button>
  );
}

function LiftingScreen({ operator, pendingCount, isOnline, onBack, onTheme, onLogout, theme }) {
  const [section, setSection] = useState('formulas');

  return (
    <section>
      <Header title="Izajes" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} onLogout={onLogout} theme={theme} />
      <div className="content">
        <div className="lifting-menu">
          <button className={section === 'formulas' ? 'active' : ''} type="button" onClick={() => setSection('formulas')}>Formulas</button>
          <button className={section === 'weight' ? 'active' : ''} type="button" onClick={() => setSection('weight')}>Calculo de peso</button>
          <button className={section === 'loadTables' ? 'active' : ''} type="button" onClick={() => setSection('loadTables')}>Tablas de carga</button>
          <button className={section === 'documentation' ? 'active' : ''} type="button" onClick={() => setSection('documentation')}>Documentacion</button>
        </div>

        {section === 'formulas' && (
          <>
            <div className="section-heading">
              <span>Modulo de formulas</span>
              <h2>Izajes</h2>
              <p>Herramientas de apoyo para evaluacion operacional de maniobras de izaje.</p>
            </div>
            <WorkCapacityCard />
            <SlingGeometryCard />
            <GravityCenterCard />
            <BoomGeometryCard />
          </>
        )}

        {section === 'weight' && <LiftingWeightCalculators />}
        {section === 'loadTables' && <LiftingPlaceholder title="Tablas de carga" text="Seccion preparada para registrar o consultar tablas de carga de gruas y equipos." />}
        {section === 'documentation' && <LiftingDocumentationChecklist />}
      </div>
    </section>
  );
}

function WorkCapacityCard() {
  const [values, setValues] = useState({ peso_carga: '', cap_grua: '' });
  const pesoCarga = Number(values.peso_carga);
  const capGrua = Number(values.cap_grua);
  const hasValidValues = pesoCarga > 0 && capGrua > 0;
  const percentage = hasValidValues ? (pesoCarga / capGrua) * 100 : 0;
  const isHighLoad = percentage >= 75;

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="card lifting-formula-card">
      <div className="card-title">Capacidad de trabajo</div>
      <p className="formula-description">Calcula el porcentaje de utilizacion de la grua respecto del peso de la carga.</p>
      <div className="form-row">
        <Field label="Peso carga" type="number" value={values.peso_carga} onChange={(value) => updateValue('peso_carga', value)} />
        <Field label="Capacidad grua" type="number" value={values.cap_grua} onChange={(value) => updateValue('cap_grua', value)} />
      </div>
      <div className={`work-capacity-result ${isHighLoad ? 'danger' : 'safe'}`}>
        <span>Resultado</span>
        <strong>{hasValidValues ? `${percentage.toFixed(2)}%` : 'Ingrese valores'}</strong>
      </div>
    </div>
  );
}

function SlingGeometryCard() {
  const [values, setValues] = useState({ peso: '', n: '', l: '', h: '' });
  const peso = Number(values.peso);
  const n = Number(values.n);
  const l = Number(values.l);
  const h = Number(values.h);
  const hasValidValues = peso > 0 && n > 0 && l > 0 && h > 0;
  const hasError = hasValidValues && l < h;
  const result = hasValidValues && !hasError ? calculateSlingGeometry(peso, n, l, h) : null;

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="card lifting-formula-card">
      <div className="card-title">Ángulo de trabajo y tensión de eslingas</div>
      <p className="formula-description">Calcula el ángulo de trabajo y la tensión por eslinga según la configuración de izaje.</p>
      <div className="form-row">
        <Field label="Peso total" type="number" inputMode="decimal" value={values.peso} onChange={(value) => updateValue('peso', value)} />
        <Field label="Número de eslingas" type="number" inputMode="numeric" value={values.n} onChange={(value) => updateValue('n', value)} />
        <Field label="Longitud eslinga (L)" type="number" inputMode="decimal" value={values.l} onChange={(value) => updateValue('l', value)} />
        <Field label="Altura gancho a carga (H)" type="number" inputMode="decimal" value={values.h} onChange={(value) => updateValue('h', value)} />
      </div>
      {hasError && <div className="weight-warning">La longitud de la eslinga debe ser mayor o igual a la altura.</div>}
      <div className="formula-results-grid">
        <FormulaResult label="Ángulo" value={result ? `${result.angulo_grados.toFixed(2)}°` : hasError ? 'Error' : 'Ingrese valores'} status={hasError ? 'danger' : 'safe'} />
        <FormulaResult label="Tensión por eslinga" value={result ? result.tension_eslinga.toFixed(2) : hasError ? 'Error' : 'Ingrese valores'} status={hasError ? 'danger' : 'safe'} />
      </div>
    </div>
  );
}

function GravityCenterCard() {
  const [pieces, setPieces] = useState(() => [
    { id: createId(), peso: '', distancia: '' },
    { id: createId(), peso: '', distancia: '' },
  ]);
  const parsedPieces = pieces
    .map((piece) => ({
      peso: Number(piece.peso),
      distancia_al_punto_cero: Number(piece.distancia),
    }))
    .filter((piece) => piece.peso > 0 && Number.isFinite(piece.distancia_al_punto_cero));
  const result = calculateCenterOfGravity(parsedPieces);
  const hasValidValues = result.peso_total > 0;

  function updatePiece(id, key, value) {
    setPieces((current) => current.map((piece) => (piece.id === id ? { ...piece, [key]: value } : piece)));
  }

  function addPiece() {
    setPieces((current) => [...current, { id: createId(), peso: '', distancia: '' }]);
  }

  function removePiece(id) {
    setPieces((current) => {
      const next = current.filter((piece) => piece.id !== id);
      return next.length ? next : [{ id: createId(), peso: '', distancia: '' }];
    });
  }

  return (
    <div className="card lifting-formula-card">
      <div className="card-title">Centro de gravedad</div>
      <p className="formula-description">Calcula el centro de gravedad de una carga asimétrica compuesta desde un punto cero definido.</p>
      <div className="pieces-list">
        {pieces.map((piece) => (
          <div className="piece-row" key={piece.id}>
            <Field label="Peso" type="number" inputMode="decimal" value={piece.peso} onChange={(value) => updatePiece(piece.id, 'peso', value)} />
            <Field label="Distancia al punto cero" type="number" inputMode="decimal" value={piece.distancia} onChange={(value) => updatePiece(piece.id, 'distancia', value)} />
            <button className="piece-remove" type="button" aria-label="Eliminar pieza" onClick={() => removePiece(piece.id)}>×</button>
          </div>
        ))}
      </div>
      <button className="btn-secondary checklist-clear" type="button" onClick={addPiece}>Agregar pieza</button>
      <div className="formula-results-grid">
        <FormulaResult label="Peso total" value={hasValidValues ? result.peso_total.toFixed(2) : 'Ingrese valores'} />
        <FormulaResult label="CG final" value={hasValidValues ? result.CG_final.toFixed(2) : 'Ingrese valores'} />
      </div>
    </div>
  );
}

function BoomGeometryCard() {
  const [values, setValues] = useState({ longitud_pluma: '', radio_operacion: '' });
  const longitudPluma = Number(values.longitud_pluma);
  const radioOperacion = Number(values.radio_operacion);
  const hasValidValues = longitudPluma > 0 && radioOperacion > 0;
  const hasError = hasValidValues && radioOperacion >= longitudPluma;
  const result = hasValidValues && !hasError ? calculateBoomGeometry(longitudPluma, radioOperacion) : null;

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="card lifting-formula-card">
      <div className="card-title">Ángulo y altura de pluma</div>
      <p className="formula-description">Calcula el ángulo de trabajo de la pluma y la altura de la punta según longitud y radio de operación.</p>
      <div className="form-row">
        <Field label="Longitud pluma (L)" type="number" inputMode="decimal" value={values.longitud_pluma} onChange={(value) => updateValue('longitud_pluma', value)} />
        <Field label="Radio operación (R)" type="number" inputMode="decimal" value={values.radio_operacion} onChange={(value) => updateValue('radio_operacion', value)} />
      </div>
      {hasError && <div className="weight-warning">El radio de operación debe ser menor que la longitud de pluma.</div>}
      <div className="formula-results-grid">
        <FormulaResult label="Ángulo pluma" value={result ? `${result.angulo_pluma_grados.toFixed(2)}°` : hasError ? 'Error' : 'Ingrese valores'} status={hasError ? 'danger' : 'safe'} />
        <FormulaResult label="Altura punta pluma" value={result ? result.altura_punta_pluma.toFixed(2) : hasError ? 'Error' : 'Ingrese valores'} status={hasError ? 'danger' : 'safe'} />
      </div>
    </div>
  );
}

function FormulaResult({ label, value, status = 'safe' }) {
  return (
    <div className={`work-capacity-result ${status}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LiftingWeightCalculators() {
  const [material, setMaterial] = useState(LIFTING_MATERIALS[0].name);
  const [solidTube, setSolidTube] = useState({
    diameter: { value: '', unit: 'cm' },
    length: { value: '', unit: 'm' },
  });
  const [emptyTube, setEmptyTube] = useState({
    diameter: { value: '', unit: 'cm' },
    thickness: { value: '', unit: 'cm' },
    length: { value: '', unit: 'm' },
  });
  const [square, setSquare] = useState({
    base: { value: '', unit: 'cm' },
    height: { value: '', unit: 'cm' },
    length: { value: '', unit: 'm' },
  });
  const density = LIFTING_MATERIALS.find((item) => item.name === material)?.density || 0;

  const solidTubeVolume = Math.PI * (toMeters(solidTube.diameter.value, solidTube.diameter.unit) / 2) ** 2 * toMeters(solidTube.length.value, solidTube.length.unit);
  const emptyTubeOuterRadius = toMeters(emptyTube.diameter.value, emptyTube.diameter.unit) / 2;
  const emptyTubeThickness = toMeters(emptyTube.thickness.value, emptyTube.thickness.unit);
  const emptyTubeInnerRadius = emptyTubeOuterRadius - emptyTubeThickness;
  const invalidEmptyTubeThickness = emptyTubeOuterRadius > 0 && emptyTubeThickness > 0 && emptyTubeInnerRadius <= 0;
  const emptyTubeVolume = emptyTubeInnerRadius > 0
    ? Math.PI * toMeters(emptyTube.length.value, emptyTube.length.unit) * (emptyTubeOuterRadius ** 2 - emptyTubeInnerRadius ** 2)
    : 0;
  const squareVolume = toMeters(square.base.value, square.base.unit) * toMeters(square.height.value, square.height.unit) * toMeters(square.length.value, square.length.unit);

  function updateMeasure(setter, key, patch) {
    setter((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  return (
    <>
      <div className="section-heading">
        <span>Calculo de peso</span>
        <h2>Material y geometria</h2>
        <p>Seleccione material e ingrese cada dimension con su unidad correspondiente.</p>
      </div>

      <div className="card lifting-controls-card">
        <div className="form-group">
          <label htmlFor="lifting-material">Material</label>
          <select id="lifting-material" value={material} onChange={(event) => setMaterial(event.target.value)}>
            {LIFTING_MATERIALS.map((item) => (
              <option value={item.name} key={item.name}>{item.name} - {item.density} kg/m3</option>
            ))}
          </select>
        </div>
      </div>

      <WeightCalculatorCard
        title="Tubo"
        fields={[
          { label: 'Diametro', value: solidTube.diameter, key: 'diameter' },
          { label: 'Longitud', value: solidTube.length, key: 'length' },
        ]}
        volume={solidTubeVolume}
        density={density}
        onChange={(key, patch) => updateMeasure(setSolidTube, key, patch)}
      />

      <WeightCalculatorCard
        title="Tubo vacio"
        fields={[
          { label: 'Diametro', value: emptyTube.diameter, key: 'diameter' },
          { label: 'Espesor', value: emptyTube.thickness, key: 'thickness' },
          { label: 'Longitud', value: emptyTube.length, key: 'length' },
        ]}
        volume={emptyTubeVolume}
        density={density}
        warning={invalidEmptyTubeThickness ? 'El diametro debe ser mayor que el doble del espesor.' : ''}
        onChange={(key, patch) => updateMeasure(setEmptyTube, key, patch)}
      />

      <WeightCalculatorCard
        title="Cuadrado"
        fields={[
          { label: 'Base', value: square.base, key: 'base' },
          { label: 'Altura', value: square.height, key: 'height' },
          { label: 'Longitud', value: square.length, key: 'length' },
        ]}
        volume={squareVolume}
        density={density}
        onChange={(key, patch) => updateMeasure(setSquare, key, patch)}
      />
    </>
  );
}

function WeightCalculatorCard({ title, fields, volume, density, warning = '', onChange }) {
  const weight = volume * density;

  return (
    <div className="card weight-calculator-card">
      <div className="card-title">{title}</div>
      <div className="weight-fields">
        {fields.map((field) => (
          <div className="measure-field" key={field.key}>
            <Field
              label={field.label}
              type="number"
              inputMode="decimal"
              value={field.value.value}
              onChange={(value) => onChange(field.key, { value })}
            />
            <div className="field-unit-toggle" role="group" aria-label={`Unidad ${field.label}`}>
              <button className={field.value.unit === 'cm' ? 'active' : ''} type="button" onClick={() => onChange(field.key, { unit: 'cm' })}>cm</button>
              <button className={field.value.unit === 'm' ? 'active' : ''} type="button" onClick={() => onChange(field.key, { unit: 'm' })}>m</button>
            </div>
          </div>
        ))}
      </div>
      {warning && <div className="weight-warning">{warning}</div>}
      <div className="weight-result">
        <span>Peso</span>
        <strong>{formatWeight(weight)}</strong>
      </div>
    </div>
  );
}

function LiftingPlaceholder({ title, text }) {
  return (
    <div className="card lifting-placeholder">
      <div className="card-title">{title}</div>
      <p>{text}</p>
    </div>
  );
}

function LiftingDocumentationChecklist() {
  const [checked, setChecked] = useState(() => Object.fromEntries(LIFTING_DOCUMENTATION_ITEMS.map((item) => [item, false])));
  const completed = LIFTING_DOCUMENTATION_ITEMS.filter((item) => checked[item]).length;
  const total = LIFTING_DOCUMENTATION_ITEMS.length;
  const percentage = Math.round((completed / total) * 100);

  function toggleItem(item) {
    setChecked((current) => ({ ...current, [item]: !current[item] }));
  }

  function clearChecklist() {
    setChecked(Object.fromEntries(LIFTING_DOCUMENTATION_ITEMS.map((item) => [item, false])));
  }

  return (
    <div className="card lifting-checklist-card">
      <div className="checklist-head">
        <div>
          <div className="card-title">Documentacion previa a maniobra</div>
          <p>Verifique los antecedentes obligatorios antes de iniciar la maniobra de izaje.</p>
        </div>
        <div className="checklist-progress">
          <strong>{completed}/{total}</strong>
          <span>{percentage}%</span>
        </div>
      </div>

      <div className="checklist-items">
        {LIFTING_DOCUMENTATION_ITEMS.map((item, index) => (
          <label className={`checklist-item ${checked[item] ? 'checked' : ''}`} key={item}>
            <input type="checkbox" checked={checked[item]} onChange={() => toggleItem(item)} />
            <span className="checklist-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="checklist-label">{item}</span>
          </label>
        ))}
      </div>

      <button className="btn-secondary checklist-clear" type="button" onClick={clearChecklist}>Limpiar checklist</button>
    </div>
  );
}

function MeasurementScreen({ operator, pendingCount, isOnline, measurement, setMeasurement, tab, setTab, records, onClearHistory, onDeleteRecord, onShareHistory, onBack, onSubmit, onTheme, onLogout, theme }) {
  const preview = calculateMeasurement(measurement);
  const [timerSeconds, setTimerSeconds] = useState(36);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    if (!timerRunning) return undefined;
    if (timerSeconds <= 0) {
      setTimerRunning(false);
      return undefined;
    }
    const timerId = window.setTimeout(() => setTimerSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearTimeout(timerId);
  }, [timerRunning, timerSeconds]);

  function startTimer() {
    if (timerSeconds <= 0) setTimerSeconds(36);
    setTimerRunning(true);
  }

  function resetTimer() {
    setTimerRunning(false);
    setTimerSeconds(36);
  }

  return (
    <section>
      <Header title="Tasa de Riego" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} onLogout={onLogout} theme={theme} />
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
                <Field label="Pila" inputMode="numeric" value={measurement.pile} onChange={(value) => setMeasurement({ ...measurement, pile: onlyDigits(value) })} />
                <Field label="Fase" value={measurement.phase} onChange={(value) => setMeasurement({ ...measurement, phase: onlyLettersAndNumbers(value) })} />
              </div>
              <div className="form-row">
                <Field label="Módulo" inputMode="numeric" value={measurement.module} onChange={(value) => setMeasurement({ ...measurement, module: onlyDigits(value) })} />
                <Field label="Paño" maxLength={1} value={measurement.panel} onChange={(value) => setMeasurement({ ...measurement, panel: normalizePanel(value) })} />
              </div>
            </div>

            <div className={`timer-card ${timerSeconds === 0 ? 'complete' : ''}`}>
              <div>
                <div className="timer-label">Cronómetro de muestreo</div>
                <div className="timer-value">00:{String(timerSeconds).padStart(2, '0')}</div>
                <div className="timer-desc">{timerSeconds === 0 ? 'Finalizado' : 'Cuenta regresiva de 36 segundos'}</div>
              </div>
              <div className="timer-actions">
                <button className="btn-save compact" type="button" onClick={startTimer} disabled={timerRunning}>
                  {timerRunning ? 'En curso' : 'Iniciar'}
                </button>
                <button className="btn-secondary compact" type="button" onClick={resetTimer}>Reiniciar</button>
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
              <div className="vol-result secondary">
                <span>Promedio</span>
                <strong>{preview.averageVolume.toFixed(2)} mL</strong>
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

        {tab === 'records' && <LocalMeasurements records={records} onClearHistory={onClearHistory} onDeleteRecord={onDeleteRecord} onShareHistory={onShareHistory} />}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = 'text', inputMode, maxLength }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input type={type} inputMode={inputMode} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function LocalMeasurements({ records, onClearHistory, onDeleteRecord, onShareHistory }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      <div className="history-actions">
        <button className="btn-share-report" type="button" onClick={onShareHistory}>Compartir reporte Excel</button>
        <button className="btn-danger-outline" type="button" onClick={() => setConfirmOpen(true)}>Eliminar todo el historial</button>
      </div>
      {records.map((record) => (
        <article className="record-item" key={record.id}>
          <div className="rec-header">
            <div>
              <strong>Pila {record.pile} · Fase {record.phase} · Módulo {record.module} · Paño {record.panel || '-'}</strong>
              <p className="record-meta">
                <span>{formatDate(record.createdAt)} · {record.operatorName}</span>
                <span>Total: {Number(record.totalVolume || 0).toFixed(2)} mL</span>
                <span>Promedio: {Number(record.averageVolume || 0).toFixed(2)} mL</span>
              </p>
            </div>
            <span className={`sync-pill ${record.syncStatus === 'synced' ? 'synced' : ''}`}>{record.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}</span>
            <button
              className="btn-record-delete"
              type="button"
              aria-label="Eliminar medición"
              onClick={() => {
                if (window.confirm('¿Confirma que desea eliminar esta medición?')) onDeleteRecord(record);
              }}
            >
              ×
            </button>
          </div>
          <div className="record-tasa">{record.irrigationRate} L/h</div>
          {record.observation ? <p className="record-note">{record.observation}</p> : null}
        </article>
      ))}
      {confirmOpen && (
        <div className="modal-overlay open" role="dialog" aria-modal="true" onClick={() => setConfirmOpen(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">Eliminar todo el historial</div>
            <p className="modal-text">
              Esta acción eliminará permanentemente los <strong>{records.length}</strong> registros guardados en este dispositivo.
            </p>
            <div className="modal-btns">
              <button className="btn-modal-cancel" type="button" onClick={() => setConfirmOpen(false)}>Cancelar</button>
              <button
                className="btn-danger-fill"
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  onClearHistory();
                }}
              >
                Sí, eliminar historial
              </button>
            </div>
          </div>
        </div>
      )}
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

function ConductionScreen({ operator, pendingCount, isOnline, documents, files, setFiles, onBack, onSubmit, onDeleteDocument, onTheme, onLogout, theme }) {
  return (
    <section>
      <Header title="Conducción" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} onLogout={onLogout} theme={theme} />
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
        <LocalDocuments documents={documents} onDelete={onDeleteDocument} />
      </div>
    </section>
  );
}

function LocalDocuments({ documents, onDelete }) {
  const [preview, setPreview] = useState(null);

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
            <button className="image-preview-button" type="button" onClick={() => setPreview({ src: doc.dataUrl, title: doc.fileName })}>
              <img src={doc.dataUrl} alt={doc.fileName} />
            </button>
            <div className="cond-thumb-info">
              <strong>{doc.fileName}</strong>
              <span>{formatDate(doc.createdAt)} · {doc.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}</span>
              <button className="btn-delete-doc" type="button" onClick={() => onDelete(doc)}>Eliminar imagen</button>
            </div>
          </article>
        ))}
      </div>
      {preview && <ImageZoomModal image={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ImageZoomModal({ image, onClose }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="image-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-modal" onClick={(event) => event.stopPropagation()}>
        <div className="image-modal-header">
          <strong>{image.title}</strong>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
        <div className="image-modal-stage">
          <img src={image.src} alt={image.title} style={{ transform: `scale(${zoom})` }} />
        </div>
        <div className="image-modal-controls">
          <button type="button" onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}>-</button>
          <input
            type="range"
            min="1"
            max="4"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Nivel de zoom"
          />
          <button type="button" onClick={() => setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))))}>+</button>
        </div>
      </div>
    </div>
  );
}

function GlossaryScreen({ operator, pendingCount, isOnline, onBack, onTheme, onLogout, theme }) {
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
      <Header title="Glosario de Términos" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} onLogout={onLogout} theme={theme} />
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
  const [activeAdminCategory, setActiveAdminCategory] = useState('measurements');

  return (
    <section>
      <Header title="Panel administrador" operator={operator} pendingCount={pendingCount} isOnline={isOnline} onBack={onBack} onTheme={onTheme} onLogout={onLogout} theme={theme} />
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
            <div className="admin-category-tabs">
              <button
                className={activeAdminCategory === 'measurements' ? 'active' : ''}
                type="button"
                onClick={() => setActiveAdminCategory('measurements')}
              >
                Medición de tasa de riego
                <span>{measurements.length} registro(s)</span>
              </button>
              <button
                className={activeAdminCategory === 'documents' ? 'active' : ''}
                type="button"
                onClick={() => setActiveAdminCategory('documents')}
              >
                Conducción
                <span>{documents.length} documento(s)</span>
              </button>
            </div>
            {activeAdminCategory === 'measurements' && <AdminMeasurements rows={measurements} />}
            {activeAdminCategory === 'documents' && <AdminDocuments rows={documents} />}
          </>
        )}
      </div>
    </section>
  );
}

function AdminMeasurements({ rows }) {
  const [exportMessage, setExportMessage] = useState('');

  async function exportRows() {
    if (!rows.length) return;
    try {
      setExportMessage('Generando reporte...');
      const result = await shareMeasurementExcel(normalizeAdminMeasurements(rows));
      setExportMessage(result);
    } catch (error) {
      if (error?.name !== 'AbortError') setExportMessage(error?.message || 'No se pudo compartir el reporte.');
    }
  }

  return (
    <div className="card">
      <div className="admin-section-head">
        <div>
          <div className="card-title">Historial de tasas de riego</div>
          <p>Registros sincronizados desde los operadores en terreno.</p>
        </div>
        <button className="btn-share-report admin-export-button" type="button" onClick={exportRows} disabled={!rows.length}>Compartir reporte Excel</button>
      </div>
      {exportMessage && <p className="admin-export-message">{exportMessage}</p>}
      {!rows.length && <div className="cond-empty-hint">No hay mediciones sincronizadas.</div>}
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
                <td>Pila {row.pile} · Fase {row.phase} · Módulo {row.module} · Paño {row.panel || '-'}</td>
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
  const [preview, setPreview] = useState(null);

  return (
    <div className="card">
      <div className="card-title">Documentación de conducción</div>
      {!rows.length && <div className="cond-empty-hint">No hay documentos sincronizados.</div>}
      <div className="admin-doc-grid">
        {rows.map((doc) => (
          <article key={doc.id} className="admin-doc-card">
            {doc.signedUrl ? (
              <button className="image-preview-button" type="button" onClick={() => setPreview({ src: doc.signedUrl, title: doc.file_name })}>
                <img src={doc.signedUrl} alt={doc.file_name} />
              </button>
            ) : null}
            <strong>{doc.driver_name}</strong>
            <span>{formatDate(doc.uploaded_at)} · {doc.file_name}</span>
          </article>
        ))}
      </div>
      {preview && <ImageZoomModal image={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default App;

