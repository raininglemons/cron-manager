// @flow
import config from './config';

const window = typeof self !== 'undefined' ? self : window;
// This works on all devices/browsers, and uses IndexedDBShim as a final fallback
const indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

const database = config.indexedDb.db;
const objectStore = config.indexedDb.objectType;

// Open (or create) the database
let openRequest = null;
let db = null;
let store = null;

// Create the schema
const upgradeNeeded = () => {
  db = openRequest.result;
  store = db.createObjectStore(objectStore, {keyPath: 'key'});
  console.log('upgradeNeeded');
};

const success = () => {
  // Start a new transaction
  db = openRequest.result;
  const tx = db.transaction(objectStore, 'readwrite');
  store = tx.objectStore(objectStore);
  console.log('store loaded');
};

const createTransaction = (fn: Function) => {
  const tx = db.transaction(objectStore, 'readwrite');
  const store = tx.objectStore(objectStore);
  fn(store);
};

export const getStore = (fn: Function) => {
  if (!openRequest) {
    openRequest = indexedDB.open(database, 1)
    openRequest.addEventListener('upgradeneeded', upgradeNeeded);
    openRequest.addEventListener('success', success);
  }

  if (db) {
    createTransaction(fn);
  } else {
    openRequest.addEventListener('success', () => createTransaction(fn));
  }
};
