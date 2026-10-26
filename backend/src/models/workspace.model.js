import mongoose from 'mongoose';
import { CURRENCIES, TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const categorySchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  archived: { type: Boolean, default: false },
  color: { type: String, match: /^#[\da-fA-F]{6}$/ }
}, { _id: false, strict: 'throw' });

const accountSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  currency: { type: String, enum: CURRENCIES, required: true },
  openingBalance: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ }
}, { _id: false, strict: 'throw' });

const recurringSchema = new mongoose.Schema({
  enabled: { type: Boolean, required: true },
  schedule: { type: String, enum: ['month-start', 'month-end', 'same-day', 'custom'] },
  dayOfMonth: { type: Number, min: 1, max: 31 },
  time: { type: String, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/ },
  nextRunDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }
}, { _id: false, strict: 'throw' });

const transactionSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true },
  title: { type: String, default: '', trim: true, maxlength: 100 },
  categoryId: { type: String, required: true, maxlength: 80 },
  transactionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  transactionTime: { type: String, default: '', match: /^$|^(?:[01]\d|2[0-3]):[0-5]\d$/ },
  note: { type: String, default: '', maxlength: 500 },
  noteImage: { type: String, default: '', maxlength: 180, match: /^$|^\/api\/v1\/auth\/transaction-images\/[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i },
  accountId: { type: String, default: null, maxlength: 80 },
  recurring: { type: recurringSchema, default: undefined },
  recurrenceSourceId: { type: String, maxlength: 80 },
  recurrenceMonth: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ }
}, { _id: false, strict: 'throw' });

const budgetSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, default: '', trim: true, maxlength: 60 },
  categoryId: { type: String, maxlength: 80 },
  month: { type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true },
  accountId: { type: String, maxlength: 80 },
  color: { type: String, default: '#557b63', match: /^#[\da-fA-F]{6}$/ }
}, { _id: false, strict: 'throw' });

const workspaceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accounts: { type: [accountSchema], default: [] },
  categories: { type: [categorySchema], default: [] },
  transactions: { type: [transactionSchema], default: [] },
  budgets: { type: [budgetSchema], default: [] },
  revision: { type: Number, default: 0, min: 0 }
}, schemaOptions);

workspaceSchema.index({ userId: 1 }, { unique: true, name: 'workspaces_user_unique' });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
