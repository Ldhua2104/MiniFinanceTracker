import mongoose from 'mongoose';
import { ANALYSIS_STATUSES, CURRENCIES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const analysisResultSchema = new mongoose.Schema({
  summary: { type: String, maxlength: 4000 },
  patterns: { type: [String], default: [] },
  suggestions: { type: [String], default: [] },
  limitations: { type: [String], default: [] }
}, { _id: false, strict: 'throw' });

const analysisInputSchema = new mongoose.Schema({
  currency: { type: String, enum: CURRENCIES, required: true },
  income: { type: mongoose.Schema.Types.Decimal128, required: true },
  expense: { type: mongoose.Schema.Types.Decimal128, required: true },
  net: { type: mongoose.Schema.Types.Decimal128, required: true },
  byCategory: [{
    categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, maxlength: 50 },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true }
  }],
  budgets: [{
    category: { type: String, required: true, maxlength: 50 },
    limit: { type: mongoose.Schema.Types.Decimal128, required: true },
    spent: { type: mongoose.Schema.Types.Decimal128, required: true }
  }]
}, { _id: false, strict: 'throw' });

const aiAnalysisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  dataRevision: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ANALYSIS_STATUSES, required: true, default: 'pending' },
  inputSummary: { type: analysisInputSchema, required: true },
  result: { type: analysisResultSchema, default: null },
  model: { type: String, default: null, maxlength: 100 },
  error: {
    code: { type: String, default: null, maxlength: 80 },
    message: { type: String, default: null, maxlength: 500 }
  }
}, schemaOptions);

aiAnalysisSchema.index({ userId: 1, month: 1, createdAt: -1 }, { name: 'ai_analyses_user_month_created' });

export const AiAnalysis = mongoose.model('AiAnalysis', aiAnalysisSchema);
