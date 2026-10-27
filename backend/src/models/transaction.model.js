import mongoose from 'mongoose';
import { CURRENCIES, TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  id: { type: String, required: true, maxlength: 80 },
  categoryId: { type: String, required: true, maxlength: 80 },
  accountId: { type: String, default: null, maxlength: 80 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  transactionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  transactionTime: { type: String, default: '', match: /^$|^(?:[01]\d|2[0-3]):[0-5]\d$/ },
  note: { type: String, default: '', maxlength: 500 },
  noteImage: { type: String, default: '', maxlength: 180, match: /^$|^\/api\/v1\/auth\/transaction-images\/[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i },
  recurring: { enabled: Boolean, schedule: { type: String, enum: ['month-start', 'month-end', 'same-day', 'custom'] }, dayOfMonth: { type: Number, min: 1, max: 31 }, time: String, nextRunDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ } },
  recurrenceSourceId: { type: String, maxlength: 80 },
  recurrenceMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  sortOrder: { type: Number, default: 0, min: 0 }
}, schemaOptions);

transactionSchema.index({ userId: 1, id: 1 }, { unique: true, name: 'transactions_user_id_unique' });
transactionSchema.index({ userId: 1, transactionDate: -1, transactionTime: -1, id: -1 }, { name: 'transactions_user_date_time_page' });
transactionSchema.index({ userId: 1, categoryId: 1, transactionDate: 1 }, { name: 'transactions_user_category_date' });
transactionSchema.index({ userId: 1, accountId: 1, transactionDate: -1 }, { name: 'transactions_user_account_date' });
transactionSchema.index({ userId: 1, 'recurring.enabled': 1, 'recurring.nextRunDate': 1 }, { partialFilterExpression: { 'recurring.enabled': true }, name: 'transactions_recurring_due' });

export const Transaction = mongoose.model('Transaction', transactionSchema);
