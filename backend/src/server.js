import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';

let server;
try {
  await connectDatabase();
  server = app.listen(env.PORT, () => {
    console.log(`Mini Finance Tracker API listening on http://localhost:${env.PORT}`);
  });
} catch (error) {
  console.error('Could not connect to MongoDB:', error.message);
  process.exitCode = 1;
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
