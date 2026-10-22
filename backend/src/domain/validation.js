import { z } from 'zod';
import { CURRENCIES, DATE_PATTERN, MONTH_PATTERN, TRANSACTION_TYPES } from './constants.js';

const dateString = z.string().regex(DATE_PATTERN, 'Expected YYYY-MM-DD');
const monthString = z.string().regex(MONTH_PATTERN, 'Expected YYYY-MM');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character ObjectId');
const amountString = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32;
const imageDataUrl = z.string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(/^(?:data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2})?$/)
  .refine((value) => !value || Buffer.from(value.slice(value.indexOf(',') + 1), 'base64').length <= MAX_IMAGE_BYTES);

export const registerInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  username: z.string().trim().min(1).max(60).default('Default User'),
  avatar: imageDataUrl.default(''),
  baseCurrency: z.enum(CURRENCIES).default('USD'),
  timezone: z.string().min(1).max(64).default('UTC')
}).strict();

export const profileInput = z.object({
  username: z.string().trim().min(1).max(60),
  avatar: imageDataUrl
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
