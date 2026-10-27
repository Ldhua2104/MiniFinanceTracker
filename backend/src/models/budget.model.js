import mongoose from 'mongoose';
import { CURRENCIES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  categoryId: { type: String, required: true, maxlength: 80 },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true },
  color: { type: String, required: true, match: /^#[\da-fA-F]{6}$/ },
  sortOrder: { type: Number, default: 0, min: 0 }
}, schemaOptions);

budgetSchema.index({ userId: 1, id: 1 }, { unique: true, name: 'budgets_user_id_unique' });
budgetSchema.index({ userId: 1, categoryId: 1 }, { unique: true, name: 'budgets_user_category_unique' });

export const Budget = mongoose.model('Budget', budgetSchema);
