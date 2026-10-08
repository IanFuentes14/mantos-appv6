let database;
export const MAX_PROCEDURE_PDF_BYTES = 50 * 1024 * 1024;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('mantos_procedures_v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents', { keyPath: 'id' });
      request.result.createObjectStore('drafts', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new Error('No se pudo abrir el almacenamiento de procedimientos.')); };
  });
  return database;
}
export async function procedureStore(store, action, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, action === 'getAll' || action === 'get' ? 'readonly' : 'readwrite');
    const request = transaction.objectStore(store)[action](value);
    transaction.oncomplete = () => { if (transaction.mode === 'readwrite') window.dispatchEvent(new Event('mantos-procedures-changed')); resolve(request.result); };
    transaction.onerror = () => reject(new Error('No se pudo guardar el PDF. Revise el espacio disponible en el dispositivo.'));
    transaction.onabort = transaction.onerror;
  });
}
export async function pdfHash(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function validatePdf(blob) {
  if (!blob || blob.size <= 0 || blob.size > MAX_PROCEDURE_PDF_BYTES) throw new Error('Seleccione un PDF de hasta 50 MB.');
  if (new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new Error('El archivo seleccionado no es un PDF válido.');
}

export async function openStoredProcedure(id) {
  const document = await procedureStore('documents', 'get', id);
  if (!document?.blob) throw new Error('Este PDF aún no está disponible offline. Sincronice con conexión antes de abrirlo.');
  if (window.Capacitor?.getPlatform?.() === 'android') {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(document.blob);
    });
    const file = await window.Capacitor.nativePromise('Filesystem', 'writeFile', { path: `procedure-${id}-v${document.version}.pdf`, directory: 'CACHE', data });
    await window.Capacitor.nativePromise('Share', 'share', { title: document.title, files: [file.uri], dialogTitle: 'Abrir procedimiento' });
  } else {
    const url = URL.createObjectURL(document.blob);
    const link = window.open(url, '_blank');
    if (!link) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = document.filename; anchor.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
