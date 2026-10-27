import mongoose from 'mongoose';
import { CURRENCIES } from '../domain/constants.js';
import { schemaOptions } from './model-options.js';

const accountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  id: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  note: { type: String, default: '', maxlength: 500 },
  currency: { type: String, enum: CURRENCIES, required: true },
  openingBalance: { type: String, required: true, match: /^\d{1,16}(?:\.\d{1,2})?$/ },
  sortOrder: { type: Number, default: 0, min: 0 }
}, schemaOptions);

accountSchema.index({ userId: 1, id: 1 }, { unique: true, name: 'accounts_user_id_unique' });
accountSchema.index({ userId: 1, sortOrder: 1 }, { name: 'accounts_user_order' });

export const Account = mongoose.model('Account', accountSchema);
