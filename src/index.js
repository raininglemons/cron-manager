// @flow

import Client from './Client';

const client = new Client;

if (window.location.search.indexOf('makeJob') > -1) {
  client.register(
    'test-job',
    3000,
    (done, ping) => setTimeout(() => done({value: 'awesome success'}), 2000),
    (response) => console.warn('Got a result :D', response)
  );
}

export default client;
