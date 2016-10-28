# Cron Manager (thing...)

## Usage

```javascript
import Client from './Client';

const client = new Client();
```

The client object has the following methods:

1. register(jobName: string, interval: number, runner: Function, callback: ?Function)

    `jobName (string)`: used to identify the job
    `interval (number)`: interval job should be run within, in milliseconds
    `runner (function)`: function that executes the job. The function is passed the following arguments:
        
        done: Function, ping: Function
        
    `callback (function)`: optional callback function. passes a single argument which is the response from
    the runner.
    
1. unregister(jobName: string)

    Job to unregister for this client. Wont stop other clients from executing the job if they
    require it.
    
The `runner` is passed the following functions as arguments:

1. done: Should be called with the job result. Alternatively the runner can synchronously return a value
    other than undefined to have this called automatically.
1. ping: Should be called on a long running job to prevent the manager assuming the job has timed out.

## Installation (for Kyle)

```javascript
npm install
npm start

```