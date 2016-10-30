// @flow
import consoleFactory from 'console-factory';
import config from './config';
import Assignee from './Assignee';
import Job from './Job';
import { getStore } from './indexedDb';
import toSimpleObject from './toSimpleObject';

const console = consoleFactory('CronDaemon.js', 3);

type JobName = string;
type AssigneeUuid = string;

type Message = {
  type: string,
  uuid: AssigneeUuid,
  job: ?JobName,
  data: ?any,
  callback: ?Function,
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
  assignees: Assignee[];
  jobs: Job[];
  localUuid: ?AssigneeUuid;
  localCallback: ?Function;
  lastMessage: ?string;
  ready: boolean;
  pendingMessages: Message[];
  isWorker: boolean;

  constructor(uuid: ?AssigneeUuid, localCallback: ?Function) {
    this.localUuid = uuid || null;
    this.localCallback = localCallback || null;
    this.assignees = [];
    this.jobs = [];
    this.ready = false;
    this.pendingMessages = [];
    this.isWorker = !uuid && !localCallback;

    this.register();

    console.log('Jobs?', this.jobs);
  }

  /**
   * Registers listeners and pulls cache of localStorage when in local mode.
   */
  register() {
    // shared worker mode
    //
    // Running as a service worker so we'll use indexeddb to save and restore
    // our state
    if (this.isWorker) {
      getStore(store => {
        const cache = store.get('cache');

        cache.onsuccess = cache.onerror = () => {
          if (cache.result) {
            const { jobs } = cache.result.state;

            this.jobs = jobs.map(metadata => {
              const job = new Job();
              console.log('Trying to restore job', metadata, job);
              return Object.assign(job, metadata);
            });
          }

          this.ready = true;

          // Now execute all cached messages
          //
          this.pendingMessages.forEach(message => this.onReceive(message));

          this.houseKeeping();
          setInterval(() => this.houseKeeping(), 100);
          // setInterval(() => this.persistState(), 1000);
        };
      });
    }
    // localStorage mode
    //
    else {
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
            console.log('Trying to restore job', metadata, job);
            return Object.assign(job, metadata);
          });
        } catch (e) {
          console.warn('Cached state unreadable', e);
        }
      }

      console.warn('Restored state', cachedState);
      this.ready = true;
      this.houseKeeping();

      window.addEventListener('storage', e => this.onReceiveMessage(e));
      setInterval(() => this.houseKeeping(), 1000);
      setInterval(() => this.persistState(), 1000);
    }
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

    // Remove jobs that have expired data and no assignees
    //
    this.jobs.filter(({
        interval,
        lastSucceeded,
        assignees,
      }) => assignees.length === 0 && lastSucceeded < now - interval)
      .forEach(job => this.unregisterJob(job));

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
    if (this.isWorker) {
      const state = {
        jobs: this.jobs,
      };
      getStore(store => {
        console.debug('Saving state', state);
        store.put({
          state,
          key: 'cache',
        });
      });
    } else {
      const state = {
        assignees: this.assignees,
        jobs: this.jobs,
      };
      const cachedState = window.localStorage.getItem(config.localStorage.metaStorageKey);
      const localState = JSON.stringify(state);

      if (cachedState !== localState) {
        window.localStorage.setItem(config.localStorage.metaStorageKey, localState);
      }
    }
  }

  /**
   * Emits a message over localStorage.
   * @param message
   * @returns {CronDaemon}
   */
  emit(message: Message): CronDaemon {
    console.warn('Emiting message', message);
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
    if (!this.ready) {
      this.pendingMessages.push(message);
    } else {
      this.onReceive(message);
    }

    if (!this.isWorker) {
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
        this.onReceivePing(message);
        break;

      case MessageTypes.REGISTERJOB:
        this.onReceiveRegisterJob(message);
        break;

      case MessageTypes.ASSIGNEDJOB:
        this.onReceiveJobAssigned(message);
        break;

      case MessageTypes.PINGJOB:
        this.onReceivePingJob(message);
        break;

      case MessageTypes.UNREGISTERASSIGNEE:
        this.onReceiveUnregisterAssignee(message);
        break;

      case MessageTypes.JOBCOMPLETED:
        this.onReceiveJobCompleted(message);
        break;

      case MessageTypes.UNREGISTERJOB:
        this.onReceiveUnregisterJob(message);
        break;

      default:
        console.warn('Unrecognised message type');
    }

    /**
     * For a shared worker, instead of a timed save of state, as we only every really
     * want to persist, last success and last result, we'll save state on demand.
     */
    if (this.isWorker) {
      switch (message.type) {
        case MessageTypes.UNREGISTERASSIGNEE:
        case MessageTypes.JOBCOMPLETED:
          this.persistState();
          break;

        default:
          // Don't persist state
      }
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
      return this.registerAssignee(message.uuid, message.callback);
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

    if (this.isWorker && this.assignees.length === 0) {
      // Shared worker is about to close as there are no more windows
      // referencing the service. Save state
      console.warn('Shared worker is about to die. Save state now');
      this.persistState();
    }
  }

  /**
   * Register a job if new, else just assign an assignee to it. Also
   * update the interval. A rule of thumb is the last registration will
   * always be the current configuration.
   * @param message
   */
  onReceiveRegisterJob(message: Message) {
    // Check we have the metadata for the job first
    const { uuid, data } = message;

    const job = this.registerJob(data);

    job.addAssignee(uuid);

    const assignee = this.getAssignee(uuid);

    assignee.addRegisteredJob(job.name);

    /**
     * If we already have a response for this job, send it to properly init
     * the assignee
     */
    if (job.lastSucceeded > 0) {
      const message = {
        type: MessageTypes.JOBCOMPLETED,
        job: job.name,
        data: job.lastResponse,
      };

      if (this.localUuid !== uuid && this.localCallback) {
        this.localCallback(message);
      }
      // Else report it to the necessary window
      //
      else if (assignee.callback) {
        assignee.callback(message);
      }
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
  }

  /**
   * React and inform an assignee if theyve been assigned a job
   * @param message
   */
  onReceiveJobAssigned(message: Message) {
    const { uuid, job } = message;

    this.getJob(job).setAssignedTo(uuid, this.now());
    const assignee = this.getAssignee(uuid).addAssignedJob(job);

    // If local
    if (uuid === this.localUuid && this.localCallback) {
      this.localCallback(message);
    }

    // Else report it to the necessary window
    //
    else if (assignee.callback) {
      console.warn('Trying to emit message over postMessage', assignee);
      assignee.callback(message);
    }
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
    else if (!this.localCallback) {
      this.assignees.filter(
          assignee => assignee.uuid !== uuid && assignee.registeredJobs.indexOf(job) > -1
        )
        .forEach(assignee => assignee.callback(message));
    }
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
   * @param callback
   */
  registerAssignee(uuid: AssigneeUuid, callback: ?Function) {
    const assignee = new Assignee(uuid, this.now(), callback);
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
      }
    });

    assignee.assignedJobs.forEach(jobName => {
      const job = this.getJob(jobName);

      job.assignedTo = null;
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
      console.debug('Amending job', job);
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
