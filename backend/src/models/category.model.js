import mongoose from 'mongoose';
import { TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const categorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  color: { type: String, match: /^#[\da-fA-F]{6}$/ },
  sortOrder: { type: Number, default: 0, min: 0 }
}, schemaOptions);

categorySchema.index({ userId: 1, id: 1 }, { unique: true, name: 'categories_user_id_unique' });
categorySchema.index({ userId: 1, type: 1, name: 1 }, { unique: true, name: 'categories_user_type_name_unique' });
categorySchema.index({ userId: 1, type: 1, archived: 1, sortOrder: 1 }, { name: 'categories_user_type_order' });

export const Category = mongoose.model('Category', categorySchema);
