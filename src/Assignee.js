// @flow

type JobName = string;
type AssigneeUuid = string;

class Assignee {
  uuid: AssigneeUuid;
  lastPing: number;
  registeredJobs: JobName[];
  assignedJobs: JobName[];
  isActive: boolean;
  callback: ?Function;

  constructor(uuid: AssigneeUuid, now: number, callback: ?Function) {
    this.uuid = uuid;
    this.lastPing = now;
    this.registeredJobs = [];
    this.assignedJobs = [];
    this.isActive = true;
    this.callback = callback;
  }

  didPing(now: number) {
    this.lastPing = now;

    return this;
  }

  removeAssignedJob(name: JobName) {
    const jobIndex = this.assignedJobs.indexOf(name);

    if (jobIndex > -1) {
      this.assignedJobs.splice(jobIndex, 1);
    }

    return this;
  }

  addAssignedJob(name: JobName) {
    const jobIndex = this.assignedJobs.indexOf(name);

    if (jobIndex === -1) {
      this.assignedJobs.push(name);
    }

    return this;
  }

  removeRegisteredJob(name: JobName) {
    const jobIndex = this.registeredJobs.indexOf(name);

    if (jobIndex > -1) {
      this.registeredJobs.splice(jobIndex, 1);
    }

    return this;
  }

  addRegisteredJob(name: JobName) {
    const jobIndex = this.registeredJobs.indexOf(name);

    if (jobIndex === -1) {
      this.registeredJobs.push(name);
    }

    return this;
  }
}

export default Assignee;
