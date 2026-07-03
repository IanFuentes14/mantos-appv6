const MEASUREMENTS_KEY = 'mantos_measurements_queue_v1';
const DOCUMENTS_KEY = 'mantos_documents_queue_v1';
const OPERATOR_KEY = 'mantos_operator_name_v1';

function readList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (error) {
    return [];
  }
}

function writeList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getOperatorName() {
  return localStorage.getItem(OPERATOR_KEY) || '';
}

export function setOperatorName(value) {
  localStorage.setItem(OPERATOR_KEY, value);
}

export function getQueuedMeasurements() {
  return readList(MEASUREMENTS_KEY);
}

export function saveQueuedMeasurements(records) {
  writeList(MEASUREMENTS_KEY, records);
}

export function addQueuedMeasurement(record) {
  const records = getQueuedMeasurements();
  records.unshift(record);
  saveQueuedMeasurements(records);
  return records;
}

export function getQueuedDocuments() {
  return readList(DOCUMENTS_KEY);
}

export function saveQueuedDocuments(records) {
  writeList(DOCUMENTS_KEY, records);
}

export function addQueuedDocument(record) {
  const records = getQueuedDocuments();
  records.unshift(record);
  saveQueuedDocuments(records);
  return records;
}

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/data:(.*);base64/)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
