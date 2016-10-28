// @flow
import uuid from 'uuid';
import CronDaemon, { MessageTypes } from './CronDaemon';
import config from './config';

type JobName = string;
type AssigneeUuid = string;

type Message = {
  type: string,
  uuid: AssigneeUuid,
  job: ?JobName,
  data: ?any,
};

type JobRunner = {
  runner: Runner,
  callback: ?Callback,
};

type Runner = (done: Function, ping: Function) => {};

type Callback = (data: ?any) => {};

class Client {
  uuid: AssigneeUuid;
  jobs: Object<JobName, JobRunner>;

  constructor() {
    this.uuid = uuid.v4();
    this.daemon = new CronDaemon(this.uuid, this.receiveMessage.bind(this));
    this.jobs = {};

    this.emit(MessageTypes.PING);
    setInterval(() => this.emit(MessageTypes.PING), config.pingInterval * 0.5);
  }

  emit(type: string, job: ?JobName, data: ?any) {
    this.daemon.send({
      type,
      job,
      data,
      uuid: this.uuid,
    });
  }

  receiveMessage(message: Message) {
    const { type, job, data } = message;

    switch (type) {
      case MessageTypes.ASSIGNEDJOB:
        return this.executeJob(job);

      case MessageTypes.JOBCOMPLETED:
        return this.completedJob(job, data);

      default:
        console.error('Unknown message type');
    }
  }

  executeJob(job: JobName) {
    console.debug('Running job', job);

    const done = (data: ?any) => {
      console.log('Done got: ', data);
      this.emit(MessageTypes.JOBCOMPLETED, job, data);
      this.completedJob(job, data);
    };

    const ping = () => {
      this.emit(MessageTypes.PINGJOB, job);
    };

    if (!this.jobs[job] || !this.jobs[job].runner) {
      throw new Error(`Couldn't find runner for ${job}`);
    }

    const response = this.jobs[job].runner(done, ping);

    if (response !== undefined) {
      done(response);
    }
  }

  completedJob(job: JobName, data: ?any) {
    console.debug('Completed job', job);

    if (!this.jobs[job] || !this.jobs[job].callback) {
      console.debug('No callback found');
    }

    this.jobs[job].callback(data);
  }

  register(job: JobName, interval: number, runner: Runner, callback: ?Callback): Client {
    if (!job) {
      throw new Error('Job name cannot be empty');
    }

    if (!interval && typeof interval !== 'number') {
      throw new Error('Interval is required and must be a number');
    }

    if (!runner && typeof runner !== 'function') {
      throw new Error('Runner is required and must be a function');
    }

    this.jobs[job] = {
      callback,
      runner,
    };

    this.emit(MessageTypes.REGISTERJOB, job, {
      interval,
      name: job,
    });

    return this;
  }

  unregister(job: JobName): Client {
    this.jobs[job] = null;

    this.emit(MessageTypes.UNREGISTERJOB, job);

    return this;
  }
}

export default Client;
