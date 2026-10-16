import mongoose from 'mongoose';
import { NOTIFICATION_THRESHOLDS } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const snapshotSchema = new mongoose.Schema({
  categoryName: { type: String, required: true, maxlength: 50 },
  spent: { type: mongoose.Schema.Types.Decimal128, required: true },
  budgetAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
  currency: { type: String, required: true, maxlength: 3 },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }
}, { _id: false, strict: 'throw' });

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget', default: null },
  threshold: { type: Number, enum: NOTIFICATION_THRESHOLDS, required: true },
  snapshot: { type: snapshotSchema, required: true },
  readAt: { type: Date, default: null }
}, schemaOptions);

notificationSchema.index(
  { budgetId: 1, threshold: 1 },
  { unique: true, partialFilterExpression: { budgetId: { $type: 'objectId' } }, name: 'notifications_budget_threshold_unique' }
);
notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 }, { name: 'notifications_user_created' });

export const Notification = mongoose.model('Notification', notificationSchema);
