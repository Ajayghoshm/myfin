// Receives files shared to the app (Web Share Target), parks them in IndexedDB
// and sends the user to the page, which uploads them to the laptop.
const DB = 'myfin-share';
const STORE = 'queue';

const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const enqueue = async (entries) => {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const e of entries) tx.objectStore(STORE).add(e);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share/receive') {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const files = form.getAll('statements').filter((f) => f instanceof File);
        await enqueue(files.map((f) => ({ name: f.name, blob: f, added: Date.now() })));
        return Response.redirect('/share/?shared=' + files.length, 303);
      })()
    );
  }
});
