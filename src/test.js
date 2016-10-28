// @flow

import Client from './Client';
import config from './config';

const client = new Client;

if (window.location.search.indexOf('makeJob') > -1) {
  client.register(
    'test-job',
    15000,
    (done, ping) => {
      setTimeout(() => {
        console.log('Delaying job by pinging it');
        ping();
      }, config.jobTimeout * 0.8);
      setTimeout(() => {
        console.log('Sending result');
        done({
          ihazGotHamburgers: Date.now(),
        });
      }, config.jobTimeout * 1.6);
      /*setTimeout(() => {
        console.log('Trying to unregister job from self');
        client.unregister('test-job');
      }, config.jobTimeout * 1.6 + 1000);*/
      console.debug('Assigned to process job');
    },
    (response) => console.warn('Got a result :D', response)
  );
}

export default client;
