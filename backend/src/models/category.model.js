import mongoose from 'mongoose';
import { TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const categorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  archivedAt: { type: Date, default: null }
}, schemaOptions);

categorySchema.index({ userId: 1, type: 1, name: 1 }, { unique: true, name: 'categories_user_type_name_unique' });

export const Category = mongoose.model('Category', categorySchema);
