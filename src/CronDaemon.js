// @flow
import uuid from 'uuid';
import config from './config';

type JobName = string;
type AssigneeUuid = string;

type Job = {
  name: JobName,
  lastAssigned: number,
  lastSucceeded: number,
  lastResponse: ?any,
  assignedTo: number,
  interval: number,
  assignees: Assignee[],
};

type Message = {
  action: string,
  uuid: AssigneeUuid,
  job: JobName,
  data: ?any,
};

class Assignee {
  uuid: AssigneeUuid;
  lastPing: number;
  registeredJobs: JobName[];
  assignedJobs: JobName[];
  isActive: boolean;

  constructor(uuid, now) {
    this.uuid = uuid;
    this.lastPing = now;
    this.registeredJobs = [];
    this.assignedJobs = [];
    this.isActive = true;
  }

  didPing(now: number) {
    this.lastPing = now;
  }

  removeAssignedJob(name: JobName) {
    const jobIndex = this.assignedJobs[name];

    if (jobIndex > -1) {
      this.assignedJobs.splice(jobIndex, 1);
    }
  }

  addAssignedJob(name: JobName) {
    const jobIndex = this.assignedJobs[name];

    if (jobIndex === -1) {
      this.assignedJobs.push(name);
    }
  }

  removeRegisteredJob(name: JobName) {
    const jobIndex = this.registeredJobs[name];

    if (jobIndex > -1) {
      this.registeredJobs.splice(jobIndex, 1);
    }
  }

  addRegisteredJob(name: JobName) {
    const jobIndex = this.registeredJobs[name];

    if (jobIndex === -1) {
      this.registeredJobs.push(name);
    }
  }

  setInactive() {
    this.isActive = false;
  }

  setActive() {
    this.isActive = true;
  }
}

class CronDaemon {
  origin: string;
  uuid: AssigneeUuid;
  assignees: Assignee[];
  jobs: Job[];

  constructor(localDaemon = true) {
    this.origin = window.location.origin;
    this.uuid = localDaemon ? uuid.v4() : null;
    this.assignees = [];
    this.jobs = [];

    this.register();

    setInterval(() => this.houseKeeping(), 1000);
    if (localDaemon) {
      setInterval(() => this.ping(), config.pingInterval * 0.5);
      setInterval(() => this.persistState(), 1000);
    }
  }

  register() {
    // localStorage mode
    //
    const cachedState = window.localStorage.getItem(config.localStorage.metaStorageKey);
    if (cachedState) {
      try {
        const { assignees, jobs } = JSON.parse(cachedState);
        this.assignees = assignees.map(metadata => {
          const assignee = new Assignee();
          return Object.assign(assignee, metadata);
        });
        this.jobs = jobs.map(metadata => {
          const job = new Job();
          return Object.assign(job, metadata);
        });
      } catch (e) {
        console.warn('Cached state unreadable', e);
      }
    }

    console.warn('Restored state', cachedState);

    this.registerAssignee(this.uuid);

    this.ping();

    window.addEventListener('storage', e => this.onReceiveMessage(e));
  }

  houseKeeping() {
    const expiredTime = this.now() - config.pingInterval;

    this.assignees.filter(assignee => assignee.lastPing < expiredTime)
      .forEach(assignee => {
        const position = this.assignees.indexOf(assignee);
        this.assignees.splice(position, 1);

        console.debug('Removing assignee from pool', assignee);
      });
  }

  persistState() {
    const cachedState = window.localStorage.getItem(config.localStorage.metaStorageKey);
    const localState = JSON.stringify({
      assignees: this.assignees,
      jobs: this.jobs,
    });

    if (cachedState !== localState) {
      window.localStorage.setItem(config.localStorage.metaStorageKey, localState);
    }
  }

  ping() {
    this.emit({
      type: 'PING',
      uuid: this.uuid,
    });

    this.getAssignee(this.uuid)
      .didPing(this.now());
  }

  emit(message: Message): CronDaemon {
    window.localStorage.setItem(config.localStorage.eventKey, JSON.stringify(message));

    return this;
  }

  onReceiveMessage(event): CronDaemon {
    //console.debug('onReceiveMessage', event, this);
    if (event.key !== config.localStorage.eventKey) {
      return;
    }

    this.onReceive(JSON.parse(event.newValue));

    return this;
  }

  onReceive(message: Message) {
    switch(message.type) {
      case 'PING':
        return this.onReceivePing(message);

      default:
        console.warn('Unrecognised message type', message);
    }
  }

  onReceivePing(message: Message) {
    const assignee = this.getAssignee(message.uuid);

    if (assignee === null) {
      return this.registerAssignee(message.uuid, this.now());
    }

    console.log(assignee, 'didPing?');
    assignee.didPing(this.now());
  }

  registerAssignee(uuid: AssigneeUuid) {
    const assignee = new Assignee(uuid, this.now());
    console.debug('Adding assignee to the pool', assignee);

    this.assignees.push(assignee);
  }

  getAssignee(uuid: AssigneeUuid): ?Assignee {
    const assignees = this.assignees.filter(assignee => uuid === assignee.uuid);

    if (assignees.length === 0) {
      return null;
    }

    return assignees[0];
  }

  now() {
    return +new Date;
  }
}

export default CronDaemon;
