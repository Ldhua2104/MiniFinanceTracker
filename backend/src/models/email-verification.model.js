import mongoose from 'mongoose';
import { schemaOptions } from './model-options.js';

const emailVerificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0, max: 5 },
  consumedAt: { type: Date, default: null }
}, schemaOptions);

emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'email_verifications_expiry_ttl' });
emailVerificationSchema.index({ userId: 1, createdAt: -1 }, { name: 'email_verifications_user_created' });

export const EmailVerification = mongoose.model('EmailVerification', emailVerificationSchema);
