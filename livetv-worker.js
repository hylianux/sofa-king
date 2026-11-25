'use strict';

// The background thread for live TV's channel store (see livetv-store.js).
const { parentPort } = require('worker_threads');
const { createStore } = require('./livetv-store');

const store = createStore();
parentPort.on('message', ({ id, op, args }) => {
  store.run(op, args).then(
    (result) => parentPort.postMessage({ id, result }),
    (err) => parentPort.postMessage({ id, error: { message: err.message, code: err.code } }),
  );
});
