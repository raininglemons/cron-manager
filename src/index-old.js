// @flow
import CronDaemon, { MessageTypes } from './CronDaemon';
import uuidFactory from 'uuid';
import config from './config';

const uuid = uuidFactory.v4();
const localCallback = message => {
  console.warn('Received local message', message);

  switch (message.type) {
    case MessageTypes.ASSIGNEDJOB:
      const { job } = message;
      setTimeout(() => {
        console.log('Delaying job by pinging it');
        cronDaemon.send({
          uuid,
          job,
          type: MessageTypes.PINGJOB,
        })
      }, config.jobTimeout * 0.8);
      setTimeout(() => {
        console.log('Sending result');
        cronDaemon.send({
          uuid,
          job,
          type: MessageTypes.JOBCOMPLETED,
          data: {
            ihazGotHamburgers: true,
          }
        })
      }, config.jobTimeout * 1.6);
      setTimeout(() => {
        console.log('Trying to unregister job from self');
        cronDaemon.send({
          uuid,
          type: MessageTypes.UNREGISTERJOB,
          job: 'domsjob',
        });
      }, config.jobTimeout * 1.6 + 1000);

    default:
      // Nothing...
  }
};

const cronDaemon = new CronDaemon(uuid, localCallback);

const ping = () => cronDaemon.send({
  uuid,
  type: MessageTypes.PING,
});

ping();
setInterval(ping, config.pingInterval * 0.5);

if (window.location.search.indexOf('makeJob') > -1) {
  cronDaemon.send({
    uuid,
    type: MessageTypes.REGISTERJOB,
    data: {
      name: 'domsjob',
      interval: 5000,
    }
  });
}

window.addEventListener('unload', function(event) {
  cronDaemon.send({
    uuid,
    type: MessageTypes.UNREGISTERASSIGNEE,
  });
});


export default cronDaemon;
