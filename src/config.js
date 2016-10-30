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
  sharedWorkerCdn: 'https://cdn.rawgit.com/raininglemons/cron-manager/b4f4f9004999d6a21685c6b1650d8970b8a7d7ee/public/5a796bbb9a4651b70d1a.sharedworker.js',
};

export default config;
