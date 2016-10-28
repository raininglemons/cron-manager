// @flow
import CronDaemon from './CronDaemon';

const daemon = new CronDaemon;

type Message = {
  type: string,
  uuid: AssigneeUuid,
  job: ?JobName,
  data: ?any,
  callback: ?Function,
};

self.addEventListener('connect', (e) => {
  const port = e.ports[0];
  const callback = (message: Message) => {
    /**
     * If we're replicating an event on, it may contain a callback to the
     * sender. We need to ensure that doesn't get forwarded on.
     */

    const cleanMessage = Object.assign({}, message, { callback: null });
    console.log('**** SENDING MESSAGE ****', cleanMessage);
    port.postMessage(cleanMessage);
  };

  port.addEventListener('message', (event) => {
    console.log('Did receive message', event);
    daemon.send(Object.assign({ callback }, event.data));
  }, true);

  port.start();
}, false);
