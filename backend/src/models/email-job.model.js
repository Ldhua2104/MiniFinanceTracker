import mongoose from 'mongoose';
import { EMAIL_JOB_STATUSES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const emailJobSchema = new mongoose.Schema({
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true },
  status: { type: String, enum: EMAIL_JOB_STATUSES, default: 'pending', required: true },
  attempts: { type: Number, min: 0, max: 3, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  workerId: { type: String, default: null, maxlength: 100 },
  providerEmailId: { type: String, default: null, maxlength: 200 },
  lastError: { type: String, default: null, maxlength: 500 },
  idempotencyKey: { type: String, required: true, maxlength: 128 }
}, schemaOptions);

emailJobSchema.index({ notificationId: 1 }, { unique: true, name: 'email_jobs_notification_unique' });
emailJobSchema.index({ status: 1, nextAttemptAt: 1 }, { name: 'email_jobs_due' });

export const EmailJob = mongoose.model('EmailJob', emailJobSchema);
