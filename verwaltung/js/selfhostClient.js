// HTTP-Client für den Werkora-Selfhost-Server (siehe selfhost-server/) -
// Ersatz für die Firestore-/Firebase-Aufrufe in db.js, auth.js,
// employeeAuth.js und blobstore.js, wenn selfhostConfig.enabled (siehe
// selfhost-config.js) aktiv ist. Relative Pfade reichen, da die App in
// diesem Betrieb vom selben Server ausgeliefert wird, der auch die API
// bereitstellt.

function encodePath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Serverfehler (${res.status})`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

// --- Auth -------------------------------------------------------------------
export async function login(email, password) {
  return request('POST', '/api/login', { email, password });
}
export async function register(email, password) {
  return request('POST', '/api/register', { email, password });
}
export async function logout() {
  return request('POST', '/api/logout');
}
export async function fetchSession() {
  try {
    return await request('GET', '/api/session');
  } catch {
    return null;
  }
}

// --- Generische Collection-API ----------------------------------------------
export async function getAllSelfhost(collectionName, filter) {
  const qs = filter && Object.keys(filter).length ? `?${new URLSearchParams(filter).toString()}` : '';
  return request('GET', `/api/${encodeURIComponent(collectionName)}${qs}`);
}

export async function getSelfhost(collectionName, id) {
  try {
    return await request('GET', `/api/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 404) return undefined;
    throw err;
  }
}

export async function putSelfhost(collectionName, value) {
  const id = value.id ?? crypto.randomUUID();
  return request('PUT', `/api/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`, { ...value, id });
}

export async function removeSelfhost(collectionName, id) {
  await request('DELETE', `/api/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`);
}

export async function clearStoreSelfhost(collectionName) {
  await request('DELETE', `/api/${encodeURIComponent(collectionName)}`);
}

// --- Dateien (Ersatz für Firebase Storage, siehe blobstore.js) --------------
export async function uploadFileSelfhost(relPath, blob) {
  const res = await fetch(`/api/files/${encodePath(relPath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Hochladen fehlgeschlagen (${res.status})`);
  return res.json();
}

export async function deleteFileSelfhost(relPath) {
  await fetch(`/api/files/${encodePath(relPath)}`, { method: 'DELETE', credentials: 'same-origin' });
}

// --- Push-Benachrichtigungen (Ersatz für Firebase Cloud Messaging, siehe push.js) ---
export async function pushVapidPublicKeySelfhost() {
  const { publicKey } = await request('GET', '/api/push/vapid-public-key');
  return publicKey;
}

export async function pushSubscribeSelfhost(subscription, { userId, role }) {
  const json = subscription.toJSON();
  return putSelfhost('pushSubscriptions', { ...json, id: json.endpoint, userId, role });
}

export async function pushUnsubscribeSelfhost(endpoint) {
  await removeSelfhost('pushSubscriptions', endpoint);
}

export async function pushNotifyRolesSelfhost(roles, { title, body, url }) {
  return request('POST', '/api/push/notify', { roles, title, body, url });
}
