import mongoose from 'mongoose';
import { schemaOptions } from './model-options.js';

const encryptedSecretSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
  keyVersion: { type: Number, required: true, min: 1 }
}, { _id: false, strict: 'throw' });

const aiSettingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  encryptedSettings: { type: encryptedSecretSchema, required: true }
}, schemaOptions);

aiSettingsSchema.index({ userId: 1 }, { unique: true, name: 'ai_settings_user_unique' });

export const AiSettings = mongoose.model('AiSettings', aiSettingsSchema);
