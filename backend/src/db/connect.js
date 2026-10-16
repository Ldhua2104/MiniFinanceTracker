import mongoose from 'mongoose';
import { env } from '../config/env.js';

mongoose.set('autoIndex', env.NODE_ENV !== 'production');

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
