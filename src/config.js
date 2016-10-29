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
};

export default config;
