// @flow

const config = {
  pingInterval: 15000,
  jobTimeout: 10000,
  localStorage: {
    eventKey: 'domsevent',
    metaStorageKey: 'domsstorage',
  },
  indexedDb: {
    db: 'domsevent',
    objectType: 'domsevent',
  },
  sharedWorkerCdn: '/5a796bbb9a4651b70d1a.sharedworker.js',
};

export default config;
