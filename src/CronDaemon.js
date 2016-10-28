// @flow
import config from './config';
import Assignee from './Assignee';
import Job from './Job';

type JobName = string;
type AssigneeUuid = string;

type Message = {
  type: string,
  uuid: AssigneeUuid,
  job: ?JobName,
  data: ?any,
};

export const MessageTypes = {
  PING: 'PING',
  REGISTERJOB: 'REGISTER-JOB',
  ASSIGNEDJOB: 'ASSIGNED-JOB',
  PINGJOB: 'PING-JOB',
  JOBCOMPLETED: 'JOB-COMPLETED',
  UNREGISTERASSIGNEE: 'UNREGISTER-ASSIGNEE',
  UNREGISTERJOB: 'UNREGISTER-JOB',
};

class CronDaemon {
  origin: string;
  assignees: Assignee[];
  jobs: Job[];
  localUuid: ?AssigneeUuid;
  localCallback: ?Function;
  lastMessage: ?string;

  constructor(uuid: ?AssigneeUuid, localCallback: ?Function) {
    this.origin = window.location.origin;
    this.localUuid = uuid || null;
    this.localCallback = localCallback || null;
    this.assignees = [];
    this.jobs = [];

    this.register();

    console.log('Jobs?', this.jobs);

    setInterval(() => this.houseKeeping(), 1000);
    if (localCallback) {
      setInterval(() => this.persistState(), 1000);
    }
  }

  /**
   * Registers listeners and pulls cache of localStorage when in local mode.
   */
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

        console.log('got any jobs?', jobs);

        this.jobs = jobs.map(metadata => {
          const job = new Job();
          console.log('Trying to restore job', metadata, job);
          return Object.assign(job, metadata);
        });
      } catch (e) {
        console.warn('Cached state unreadable', e);
      }
    }

    console.warn('Restored state', cachedState);

    window.addEventListener('storage', e => this.onReceiveMessage(e));
  }

  /**
   * Trims out assignees that haven't reported back and fires off any
   * events that need to run.
   */
  houseKeeping() {
    // Remove expired assignees that have been out of contact for too
    // long
    const now = this.now();
    const expiredTime = now - config.pingInterval;

    this.assignees.filter(assignee => assignee.lastPing < expiredTime)
      .forEach(({ uuid }) => this.unregisterAssignee(uuid));

    // Redistribute any jobs that have timed out
    //
    const timedoutTime = now - config.jobTimeout;
    this.jobs.filter(({
        assignedTo,
        lastAssigned,
      }) => assignedTo !== null && lastAssigned < timedoutTime)
      .forEach(job => this.distributeJob(job));

    // Distribute any jobs that are due to be run
    this.jobs.filter(({
        assignedTo,
        interval,
        lastSucceeded,
      }) => assignedTo === null && lastSucceeded < now - interval)
      .forEach(job => this.distributeJob(job))
  }

  /**
   * When in local mode, intermittantly persist state to localStorage so
   * new tabs can jump right into the same state we're currently in.
   */
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

  /**
   * Emits a message over localStorage.
   * @param message
   * @returns {CronDaemon}
   */
  emit(message: Message): CronDaemon {
    const json = JSON.stringify(message);
    this.lastMessage = json;
    window.localStorage.setItem(config.localStorage.eventKey, json);

    return this;
  }

  /**
   * This takes messages a message, processes it and emits it over localstorage if
   * running locally.
   * @param message
   * @returns {CronDaemon}
   */
  send(message: Message): CronDaemon {
    this.onReceive(message);

    if (this.localUuid && this.localCallback) {
      // Message was from a local source, replicate it on to
      // any other instances.
      this.emit(message);
    }

    return this;
  }

  /**
   * This receives messages from localstorage (ie another crondaemon instance).
   * @param event
   * @returns {*}
   */
  onReceiveMessage(event): CronDaemon {
    //console.debug('onReceiveMessage', event, this);
    if (event.key !== config.localStorage.eventKey) {
      return;
    }

    // Ensure another tab hasn't came to the same decision as we have just done
    // at the exact same time. If so, ignore
    if (event.newValue === this.lastMessage) {
      return;
    }

    this.onReceive(JSON.parse(event.newValue));

    return this;
  }

  /**
   * Message handler, whether it be an internal / external message thats been
   * received.
   * @param message
   * @returns {*}
   */
  onReceive(message: Message) {
    console.debug('Received message', message);
    switch (message.type) {
      case MessageTypes.PING:
        return this.onReceivePing(message);

      case MessageTypes.REGISTERJOB:
        return this.onReceiveJobRegistration(message);

      case MessageTypes.ASSIGNEDJOB:
        return this.onReceiveJobAssigned(message);

      case MessageTypes.PINGJOB:
        return this.onReceivePingJob(message);

      case MessageTypes.UNREGISTERASSIGNEE:
        return this.onReceiveUnregisterAssignee(message);

      case MessageTypes.JOBCOMPLETED:
        return this.onReceiveJobCompleted(message);

      case MessageTypes.UNREGISTERJOB:
        return this.onReceiveUnregisterJob(message);

      default:
        console.warn('Unrecognised message type');
    }
  }

  /**
   * Update an assignees last ping time
   * @param message
   * @returns {*}
   */
  onReceivePing(message: Message) {
    const assignee = this.getAssignee(message.uuid);

    if (assignee === null) {
      return this.registerAssignee(message.uuid, this.now());
    }

    assignee.didPing(this.now());
  }

  /**
   * Unregister an assignee that has reported its exit.
   * @param message
   */
  onReceiveUnregisterAssignee(message: Message) {
    const { uuid } = message;

    this.unregisterAssignee(uuid);
  }

  /**
   * Register a job if new, else just assign an assignee to it. Also
   * update the interval. A rule of thumb is the last registration will
   * always be the current configuration.
   * @param message
   */
  onReceiveJobRegistration(message: Message) {
    // Check we have the metadata for the job first
    const { uuid, data } = message;

    const job = this.registerJob(data);

    job.addAssignee(uuid);

    const assignee = this.getAssignee(uuid);

    if (assignee.registeredJobs.indexOf(job.name) === -1) {
      assignee.registeredJobs.push(job.name);
    }
  }

  /**
   * React to an assignee unregistering themselves from a job
   * @param message
   */
  onReceiveUnregisterJob(message: Message) {
    const { uuid, job } = message;

    const assignee = this.getAssignee(uuid);
    const targetedJob = this.getJob(job);

    targetedJob.removeAssignee(uuid);
    assignee.removeAssignedJob(job).removeRegisteredJob(job);

    // If no assignees left then delete the job
    //
    if (targetedJob.assignees.length === 0) {
      this.unregisterJob(targetedJob);
    }
  }

  /**
   * React and inform an assignee if theyve been assigned a job
   * @param message
   */
  onReceiveJobAssigned(message: Message) {
    const { uuid, job } = message;

    this.getJob(job).setAssignedTo(uuid, this.now());
    this.getAssignee(uuid).addAssignedJob(job);

    // If local
    if (uuid === this.localUuid && this.localCallback) {
      this.localCallback(message);
    }

    // Else report it to the necessary window
    //
  }

  /**
   * Extend the "grace" period on a jobs execution if a job ping is
   * received.
   * @param message
   */
  onReceivePingJob(message: Message) {
    const { uuid, job } = message;

    const targetedJob = this.getJob(job);

    if (targetedJob.assignedTo === uuid) {
      targetedJob.setAssignedTo(uuid, this.now());
    }
  }

  /**
   * Set a job to done and distribute the response to any other assignees
   * that want it.
   * @param message
   */
  onReceiveJobCompleted(message: Message) {
    const { uuid, job, data } = message;

    this.getAssignee(uuid).removeAssignedJob(job);
    this.getJob(job).setCompleted(this.now(), data);

    // If "relevant" to local (and local hasnt done the job, theyll already have the
    // response
    if (this.localUuid !== uuid && this.localCallback) {
      if (this.getAssignee(this.localUuid).registeredJobs.indexOf(job) > -1) {
        this.localCallback(message);
      }
    }

    // Else report it to the necessary window
    //
  }

  /**
   * Try to intelligently distribute out a job to an assignee. Tries to find an assignee
   * in the following orders:
   * isActive = higher priority
   * Active Job content = lower the number the higher priority
   * Last checked in time = the more recent the higher the priority
   * @param job
   */
  distributeJob(job: Job) {
    // Sort assignees by active first, then by how many jobs
    // already assigned to them in a descending order
    console.warn('DISTRIBUTING JOB', this.now() - job.lastSucceeded);

    const assignees = this.assignees
      .filter(assignee => assignee.registeredJobs.indexOf(job.name) > -1)
      .sort((a, b) => {
        if (b.isActive && !a.isActive) {
          return 1;
        } else if (a.isActive && !b.isActive) {
          return -1;
        }

        const aJobs = a.assignedJobs.length;
        const bJobs = b.assignedJobs.length;

        if (aJobs === bJobs) {
          // Instead sort by last pinged in
          //
          return b.lastPing - a.lastPing;
        }

        return aJobs - bJobs;
      });

    if (assignees.length === 0) {
      console.error('No assignees for job', job);
      this.unregisterJob(job);
      return;
    }

    const activeAssignees = assignees.filter(assignee => assignee.isActive);

    if (activeAssignees.length) {
      this.assignJob(activeAssignees[0], job);
    } else {
      this.assignJob(assignees[0], job);
    }
  }

  /**
   * Sends a message informing all daemons (or just itself) that a job has
   * been assigned to someone.
   * @param assignee
   * @param job
   */
  assignJob(assignee: Assignee, job: Job) {
    // Emit message to assignee to start the job
    //
    this.send({
      uuid: assignee.uuid,
      job: job.name,
      type: MessageTypes.ASSIGNEDJOB,
    });
  }

  /**
   * Registers a new assignee into the pool
   * @param uuid
   */
  registerAssignee(uuid: AssigneeUuid) {
    const assignee = new Assignee(uuid, this.now());
    console.debug('Adding assignee to the pool', assignee);

    this.assignees.push(assignee);
  }

  /**
   * Unregisters an assignee and cleans up any outstanding jobs they
   * may have assigned to themselves.
   * @param uuid
   */
  unregisterAssignee(uuid: AssigneeUuid) {
    const assignee = this.getAssignee(uuid);

    if (assignee === null) {
      return;
    }

    const position = this.assignees.indexOf(assignee);
    this.assignees.splice(position, 1);

    assignee.registeredJobs.forEach(jobName => {
      const job = this.getJob(jobName);
      const position = job.assignees.indexOf(uuid);

      if (position !== -1) {
        job.assignees.splice(position, 1);

        if (job.assignees.length === 0) {
          // No one registered for this job anymore, remove
          // it.

          this.unregisterJob(job);
        }
      }
    });

    console.debug('Removing assignee from pool', assignee);
  }

  /**
   * Returns an assignee object or null if not found.
   * @param uuid
   * @returns {*}
   */
  getAssignee(uuid: AssigneeUuid): ?Assignee {
    const assignees = this.assignees.filter(assignee => uuid === assignee.uuid);

    if (assignees.length === 0) {
      return null;
    }

    return assignees[0];
  }

  /**
   * Registers a new job object and updates its interval
   * @param job
   * @returns {*}
   */
  registerJob(job: Job): Job {
    const { name, interval } = job;

    const savedJob = this.getJob(name);

    if (savedJob !== null) {
      console.debug('Ammending job', job);
      savedJob.setInterval(interval);

      return savedJob;
    }

    console.debug('Registering job', job);
    const newJob = new Job(name, interval);

    this.jobs.push(newJob);

    return newJob;
  }

  /**
   * Unregisters a job.
   * @param job
   */
  unregisterJob(job: Job) {
    this.jobs.filter(({ name }) => name === job.name)
      .forEach(jobToRemove => {
        const index = this.jobs.indexOf(jobToRemove);

        this.jobs.splice(index, 1);
      })
  }

  /**
   * Returns a job object or null if not found
   * @param name
   * @returns {*}
   */
  getJob(name: JobName): ?Job {
    const jobs = this.jobs.filter(job => name === job.name);

    if (jobs.length === 0) {
      return null;
    }

    return jobs[0];
  }

  /**
   * Returns the timestamp now.
   * @returns {number}
   */
  now() {
    return Date.now();
  }
}

export default CronDaemon;
