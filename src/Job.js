// @flow

type JobName = string;
type AssigneeUuid = string;

class Job {
  name: JobName;
  lastAssigned: number;
  lastSucceeded: number;
  lastResponse: ?any;
  assignedTo: number;
  interval: number;
  assignees: Assignee[];

  constructor(name: JobName, interval: number) {
    this.name = name;
    this.interval = interval;
    this.lastSucceeded = 0;
    this.lastResponse = null;
    this.assignedTo = null;
    this.assignees = [];
  }

  setInterval(interval: number) {
    this.interval = interval;
  }

  setAssignedTo(uuid: AssigneeUuid, now: number) {
    this.assignedTo = uuid;
    this.lastAssigned = now;
  }

  setCompleted(now: number, response: ?any) {
    this.lastSucceeded = now;
    this.lastResponse = response;
    this.assignedTo = null;
  }

  removeAssignee(uuid: AssigneeUuid) {
    const assigneeIndex = this.assignees.indexOf(uuid);

    if (assigneeIndex > -1) {
      this.assignees.splice(assigneeIndex, 1);
    } else {
      console.warn('Couldnt find uuid to remove', uuid, this);
    }

    if (this.assignedTo === uuid) {
      this.assignedTo = null;
    }
  }

  addAssignee(uuid: AssigneeUuid) {
    const assigneeIndex = this.assignees.indexOf(uuid);

    if (assigneeIndex === -1) {
      this.assignees.push(uuid);
    }
  }
}

export default Job;
