import mongoose from 'mongoose';
import { schemaOptions } from './model-options.js';

const incomeSourceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  color: { type: String, match: /^#[\da-fA-F]{6}$/ },
  sortOrder: { type: Number, default: 0, min: 0 }
}, schemaOptions);

incomeSourceSchema.index({ userId: 1, id: 1 }, { unique: true, name: 'income_sources_user_id_unique' });
incomeSourceSchema.index({ userId: 1, name: 1 }, { unique: true, name: 'income_sources_user_name_unique' });
incomeSourceSchema.index({ userId: 1, archived: 1, sortOrder: 1 }, { name: 'income_sources_user_order' });

export const IncomeSource = mongoose.model('IncomeSource', incomeSourceSchema);
