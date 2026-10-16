import { z } from 'zod';
import { CURRENCIES, DATE_PATTERN, MONTH_PATTERN, TRANSACTION_TYPES } from './constants.js';

const dateString = z.string().regex(DATE_PATTERN, 'Expected YYYY-MM-DD');
const monthString = z.string().regex(MONTH_PATTERN, 'Expected YYYY-MM');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character ObjectId');
const amountString = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);

export const registerInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  baseCurrency: z.enum(CURRENCIES).default('USD'),
  timezone: z.string().min(1).max(64).default('UTC')
}).strict();

export const transactionCreateInput = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: amountString,
  currency: z.enum(CURRENCIES),
  categoryId: objectId,
  transactionDate: dateString,
  note: z.string().trim().max(500).optional().default('')
}).strict();

export const transactionPatchInput = z.object({
  amount: amountString.optional(),
  currency: z.enum(CURRENCIES).optional(),
  categoryId: objectId.optional(),
  transactionDate: dateString.optional(),
  note: z.string().trim().max(500).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const budgetCreateInput = z.object({
  month: monthString,
  categoryId: objectId,
  amount: amountString
}).strict();
