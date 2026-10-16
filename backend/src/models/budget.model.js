import mongoose from 'mongoose';
import { CURRENCIES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
  currency: { type: String, enum: CURRENCIES, required: true }
}, schemaOptions);

budgetSchema.index({ userId: 1, categoryId: 1, month: 1 }, { unique: true, name: 'budgets_user_category_month_unique' });

export const Budget = mongoose.model('Budget', budgetSchema);
