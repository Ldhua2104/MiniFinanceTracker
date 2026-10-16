import mongoose from 'mongoose';
import { CURRENCIES, TRANSACTION_TYPES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const categorySchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  archived: { type: Boolean, default: false }
}, { _id: false, strict: 'throw' });

const transactionSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true },
  categoryId: { type: String, required: true, maxlength: 80 },
  transactionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  note: { type: String, default: '', maxlength: 500 }
}, { _id: false, strict: 'throw' });

const budgetSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 80 },
  categoryId: { type: String, required: true, maxlength: 80 },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  amount: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  currency: { type: String, enum: CURRENCIES, required: true }
}, { _id: false, strict: 'throw' });

const workspaceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  categories: { type: [categorySchema], default: [] },
  transactions: { type: [transactionSchema], default: [] },
  budgets: { type: [budgetSchema], default: [] },
  revision: { type: Number, default: 0, min: 0 }
}, schemaOptions);

workspaceSchema.index({ userId: 1 }, { unique: true, name: 'workspaces_user_unique' });

export const Workspace = mongoose.model('Workspace', workspaceSchema);
