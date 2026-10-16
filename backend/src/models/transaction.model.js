import mongoose from 'mongoose';
import { CURRENCIES, TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const decimal128 = mongoose.Schema.Types.Decimal128;
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  amount: { type: decimal128, required: true, min: 0 },
  currency: { type: String, enum: CURRENCIES, required: true },
  transactionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  note: { type: String, default: '', maxlength: 500 },
  fxRate: { type: decimal128, required: true, min: 0 },
  fxDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  baseCurrency: { type: String, enum: CURRENCIES, required: true },
  baseAmount: { type: decimal128, required: true, min: 0 }
}, schemaOptions);

transactionSchema.index({ userId: 1, transactionDate: -1, _id: -1 }, { name: 'transactions_user_date_page' });
transactionSchema.index({ userId: 1, categoryId: 1, transactionDate: 1 }, { name: 'transactions_user_category_date' });

export const Transaction = mongoose.model('Transaction', transactionSchema);
