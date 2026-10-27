import mongoose from 'mongoose';
import { env } from '../config/env.js';

// Index creation is handled explicitly by `npm run db:indexes` so it cannot
// race with migration or another running backend process.
mongoose.set('autoIndex', false);

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
