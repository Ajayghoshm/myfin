const DB = 'myfin-share';
const STORE = 'queue';
const $ = (id) => document.getElementById(id);

const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const readAll = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const items = [];
    const cursor = db.transaction(STORE).objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(items);
      items.push({ key: c.key, ...c.value });
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
};

const removeKey = async (key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

const getToken = () => {
  try { return localStorage.getItem('shareToken') || ''; } catch { return ''; }
};

const render = async () => {
  const items = await readAll();
  $('queue').innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = `${it.name} (${Math.round(it.blob.size / 1024) || 1} KB) - waiting`;
    $('queue').append(li);
  }
  return items;
};

let sending = false;
const sendAll = async () => {
  if (sending) return;
  sending = true;
  try {
    const items = await render();
    if (!items.length) { $('status').textContent = 'Nothing waiting.'; return; }
    if (!getToken()) { $('pair').hidden = false; $('status').textContent = 'Pair this phone first.'; return; }
    let sent = 0;
    for (const it of items) {
      const res = await fetch('/share/upload?name=' + encodeURIComponent(it.name), {
        method: 'POST',
        headers: { 'x-share-token': getToken(), 'content-type': 'text/plain' },
        body: await it.blob.text(),
      });
      if (res.status === 401) { try { localStorage.removeItem('shareToken'); } catch {} $('pair').hidden = false; $('status').textContent = 'This phone is no longer paired - pair again.'; break; }
      if (!res.ok) { $('status').textContent = 'Laptop rejected a file (' + res.status + ').'; break; }
      await removeKey(it.key);
      sent++;
    }
    const left = await render();
    if (!left.length && sent) $('status').textContent = `Sent ${sent} file(s) to the laptop inbox.`;
  } catch {
    $('status').textContent = 'Laptop not reachable - files are kept, try again on the same Wi-Fi.';
  } finally {
    sending = false;
  }
};

$('send').onclick = sendAll;
const pair = async (code) => {
  $('status').textContent = 'Pairing...';
  try {
    const res = await fetch('/share/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone' }),
    });
    if (!res.ok) { $('status').textContent = 'Wrong or expired code - generate a new one on the laptop.'; return; }
    localStorage.setItem('shareToken', (await res.json()).token);
    $('pair').hidden = true;
    $('status').textContent = 'Paired.';
    sendAll();
  } catch {
    $('status').textContent = 'Laptop not reachable.';
  }
};

$('save').onclick = () => pair($('code').value.trim());
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) { history.replaceState(null, '', '/share/'); pair(urlCode); }
window.addEventListener('online', sendAll);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/share/sw.js', { scope: '/share/' });
render().then(() => { if (!getToken()) $('pair').hidden = false; return urlCode ? null : sendAll(); });
