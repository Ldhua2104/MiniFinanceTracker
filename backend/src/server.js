import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';

let server;
let shuttingDown = false;
server = app.listen(env.PORT, () => {
  console.log(`Mini Finance Tracker API listening on http://localhost:${env.PORT}`);
  void connectWithRetry();
});

async function connectWithRetry() {
  if (shuttingDown) return;
  try {
    await connectDatabase();
    console.log('MongoDB connected');
  } catch (error) {
    console.error(`MongoDB unavailable; anonymous mode remains available: ${error.message}`);
    const retry = setTimeout(() => void connectWithRetry(), 10000);
    retry.unref();
  }
}

async function shutdown(signal) {
  shuttingDown = true;
  console.log(`${signal} received; shutting down`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
