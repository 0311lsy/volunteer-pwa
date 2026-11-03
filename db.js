'use strict';
const DB_NAME = 'VolunteerDB';
const DB_VERSION = 1;
const STORE_RECORDS = 'volunteerRecords';
const STORE_SETTINGS = 'settings';
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

async function addRecord(rec) {
  const store = await tx(STORE_RECORDS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllRecords() {
  const store = await tx(STORE_RECORDS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getRecord(id) {
  const store = await tx(STORE_RECORDS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecordById(id) {
  const store = await tx(STORE_RECORDS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  const store = await tx(STORE_SETTINGS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(handle, 'dirHandle');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getSavedDirHandle() {
  const store = await tx(STORE_SETTINGS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get('dirHandle');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
