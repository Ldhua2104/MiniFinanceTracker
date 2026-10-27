import mongoose from 'mongoose';
import { CURRENCIES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const userProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true, trim: true, default: 'Default User', maxlength: 60 },
  avatarPath: { type: String, default: '', maxlength: 180, match: /^$|^\/api\/v1\/auth\/avatars\/[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i },
  baseCurrency: { type: String, enum: CURRENCIES, default: 'USD', required: true },
  timezone: { type: String, default: 'UTC', required: true, maxlength: 64 },
  emailAlertsEnabled: { type: Boolean, default: false }
}, schemaOptions);

userProfileSchema.index({ userId: 1 }, { unique: true, name: 'user_profiles_user_unique' });

export const UserProfile = mongoose.model('UserProfile', userProfileSchema);
