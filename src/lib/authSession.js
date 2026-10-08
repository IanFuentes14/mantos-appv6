// Operator authentication must never sign out or overwrite the administrator client.
export async function ensureOperatorSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session?.user?.is_anonymous) return data.session;
  if (data.session) throw new Error('La sesión técnica debe estar separada del administrador.');
  const result = await client.auth.signInAnonymously();
  if (result.error) throw result.error;
  return result.data.session;
}

export async function getAdminSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user?.is_anonymous) {
    throw new Error('La sesión administrativa venció. Vuelva a ingresar con su correo y contraseña.');
  }
  return data.session;
}

// Retain the anonymous identity so previously uploaded records remain editable.
export function migrateOperatorSession(storage, previousKey, operatorKey) {
  if (!storage || storage.getItem(operatorKey)) return;
  const raw = storage.getItem(previousKey);
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  if (!saved?.user?.is_anonymous) return;
  storage.setItem(operatorKey, raw);
  storage.removeItem(previousKey);
}
