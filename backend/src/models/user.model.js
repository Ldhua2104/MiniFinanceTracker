import mongoose from 'mongoose';
import { CURRENCIES, USER_ROLES, USER_STATUSES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  username: { type: String, required: true, trim: true, default: 'Default User', maxlength: 60 },
  avatar: { type: String, default: '', maxlength: 6990540 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: USER_ROLES, default: 'user', required: true },
  status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
  baseCurrency: { type: String, enum: CURRENCIES, default: 'USD', required: true },
  timezone: { type: String, required: true, default: 'UTC', maxlength: 64 },
  emailVerifiedAt: { type: Date, default: null },
  emailAlertsEnabled: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 0, min: 0 },
  dataRevision: { type: Number, default: 0, min: 0 }
}, schemaOptions);

userSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });

export const User = mongoose.model('User', userSchema);
