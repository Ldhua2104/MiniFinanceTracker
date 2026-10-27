import mongoose from 'mongoose';
import { schemaOptions } from './model-options.js';

const workspaceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revision: { type: Number, default: 0, min: 0 },
  schemaVersion: { type: Number, default: 2, min: 1 }
}, schemaOptions);

workspaceSchema.index({ userId: 1 }, { unique: true, name: 'workspaces_user_unique' });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
