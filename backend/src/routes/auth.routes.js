import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { User, Workspace } from '../models/index.js';
import { MAX_IMAGE_BYTES, profileInput, registerInput } from '../domain/validation.js';
import { CURRENCIES } from '../domain/constants.js';
import { requireCsrf } from '../middleware/csrf.js';
import { requireUser, SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions, clearSessionCookieOptions, csrfCookieOptions, signSession, verifySessionToken } from '../middleware/auth.js';

export const authRouter = Router();
const transactionImageRoot = fileURLToPath(new URL('../../storage/transaction-images/', import.meta.url));
const transactionImageInput = z.object({
  image: z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
}).strict();
const transactionImagePath = z.string().max(180).regex(/^\/api\/v1\/auth\/transaction-images\/[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i);
const loginInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();
const recurringInput = z.object({
  enabled: z.boolean(),
  schedule: z.enum(['month-start', 'month-end', 'custom']).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).strict().superRefine((rule, context) => {
  if (!rule.enabled) return;
  if (!rule.schedule || !rule.time || !rule.nextRunDate) context.addIssue({ code: 'custom', message: 'Enabled recurring transactions require a schedule, time and next run date' });
  if (rule.schedule === 'custom' && !rule.dayOfMonth) context.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Custom recurrence requires a day of month' });
});

const workspaceInput = z.object({
  accounts: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60),
    currency: z.enum(CURRENCIES), openingBalance: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  }).strict()).max(100),
  categories: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(50),
    type: z.enum(['income', 'expense']), archived: z.boolean().default(false)
  }).strict()).max(500),
  transactions: z.array(z.object({
    id: z.string().min(1).max(80), type: z.enum(['income', 'expense']),
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => new Decimal(value).gt(0)), currency: z.enum(CURRENCIES),
    title: z.string().trim().max(100).optional().default(''),
    categoryId: z.string().min(1).max(80), transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    transactionTime: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().default(''),
    note: z.string().max(500).default(''), noteImage: transactionImagePath.optional().default(''),
    accountId: z.string().min(1).max(80).nullable().optional(), recurring: recurringInput.optional(),
    recurrenceSourceId: z.string().min(1).max(80).optional(), recurrenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
  }).strict()).max(10000),
  budgets: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().max(60).optional().default(''),
    categoryId: z.string().min(1).max(80).optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => new Decimal(value).gt(0)),
    currency: z.enum(CURRENCIES), accountId: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[\da-fA-F]{6}$/).optional().default('#557b63')
  }).strict().refine((budget) => budget.name.length > 0 || Boolean(budget.categoryId && budget.month), 'A budget name is required')).max(1000)
}).strict().superRefine((workspace, context) => {
  const checkUnique = (items, label) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({ code: 'custom', path: [label, index, 'id'], message: 'Ids must be unique' });
      seen.add(item.id);
    });
  };
  checkUnique(workspace.accounts, 'accounts');
  checkUnique(workspace.categories, 'categories');
  checkUnique(workspace.transactions, 'transactions');
  checkUnique(workspace.budgets, 'budgets');
  const accountIds = new Set(workspace.accounts.map((account) => account.id));
  const accountById = new Map(workspace.accounts.map((account) => [account.id, account]));
  const categoryIds = new Set(workspace.categories.map((category) => category.id));
  const categoryById = new Map(workspace.categories.map((category) => [category.id, category]));
  workspace.transactions.forEach((transaction, index) => {
    if (transaction.accountId && !accountIds.has(transaction.accountId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'accountId'], message: 'Account does not exist in this workspace' });
    if (!categoryIds.has(transaction.categoryId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'categoryId'], message: 'Category does not exist in this workspace' });
  });
  workspace.budgets.forEach((budget, index) => {
    if (budget.categoryId && !categoryIds.has(budget.categoryId)) context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Category does not exist in this workspace' });
    if (budget.categoryId && categoryById.get(budget.categoryId)?.type !== 'expense') context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Budgets must use an expense category' });
    if (budget.accountId && !accountIds.has(budget.accountId)) context.addIssue({ code: 'custom', path: ['budgets', index, 'accountId'], message: 'Account does not exist in this workspace' });
    if (budget.accountId && accountById.get(budget.accountId)?.currency !== budget.currency) context.addIssue({ code: 'custom', path: ['budgets', index, 'currency'], message: 'Budget currency must match the linked account' });
  });
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username || 'Default User',
    avatar: user.avatar || '',
    role: user.role,
    status: user.status,
    baseCurrency: user.baseCurrency,
    timezone: user.timezone,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailAlertsEnabled: user.emailAlertsEnabled
  };
}

function sendSession(res, user) {
  res.cookie(SESSION_COOKIE, signSession(user), sessionCookieOptions());
}

authRouter.get('/csrf', (req, res) => {
  const csrfToken = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
  res.json({ data: { csrfToken }, meta: { requestId: req.requestId } });
});

authRouter.post('/transaction-images', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const { image } = transactionImageInput.parse(req.body);
    const [, mime, encoded] = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: { code: 'IMAGE_TOO_LARGE', message: 'Image must be 5 MB or smaller' }, meta: { requestId: req.requestId } });
    }
    const validSignature = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      : mime === 'image/gif' ? buffer.subarray(0, 4).toString('ascii') === 'GIF8'
      : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!validSignature) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'The uploaded file is not a supported image' }, meta: { requestId: req.requestId } });
    }
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
    const filename = `${randomUUID()}.${extension}`;
    const userDirectory = path.join(transactionImageRoot, req.user.id);
    await mkdir(userDirectory, { recursive: true });
    await writeFile(path.join(userDirectory, filename), buffer, { flag: 'wx' });
    res.status(201).json({ data: { path: `/api/v1/auth/transaction-images/${filename}` }, meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please choose a supported image', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

authRouter.get('/transaction-images/:filename', requireUser, async (req, res, next) => {
  if (!/^[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i.test(req.params.filename)) return res.status(404).end();
  try {
    const image = await readFile(path.join(transactionImageRoot, req.user.id, req.params.filename));
    const extension = path.extname(req.params.filename).toLowerCase();
    const mime = extension === '.jpg' ? 'image/jpeg' : `image/${extension.slice(1)}`;
    res.set('Cache-Control', 'private, max-age=3600').set('X-Content-Type-Options', 'nosniff').type(mime).send(image);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).end();
    next(error);
  }
});

authRouter.post('/register', requireCsrf, async (req, res, next) => {
  try {
    const input = registerInput.parse(req.body);
    const passwordHash = await argon2.hash(input.password);
    const user = await User.create({
      email: input.email,
      username: input.username,
      avatar: input.avatar,
      passwordHash,
      role: 'user',
      status: 'active',
      baseCurrency: input.baseCurrency,
      timezone: input.timezone
    });
    sendSession(res, user);
    res.status(201).json({ data: publicUser(user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' }, meta: { requestId: req.requestId } });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

authRouter.post('/login', requireCsrf, async (req, res, next) => {
  try {
    const input = loginInput.parse(req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    const valid = user?.passwordHash ? await argon2.verify(user.passwordHash, input.password) : false;
    if (!user || !valid || user.status !== 'active') {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' }, meta: { requestId: req.requestId } });
    }
    sendSession(res, user);
    res.json({ data: publicUser(user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ data: publicUser(req.user), meta: { requestId: req.requestId } });
});

authRouter.patch('/profile', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const input = profileInput.parse(req.body);
    req.user.username = input.username;
    req.user.avatar = input.avatar;
    await req.user.save();
    res.json({ data: publicUser(req.user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

authRouter.post('/logout', requireCsrf, async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const payload = verifySessionToken(token);
      await User.updateOne({ _id: payload.sub, sessionVersion: payload.sv }, { $inc: { sessionVersion: 1 } });
    }
    res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
    res.status(204).end();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
      return res.status(204).end();
    }
    next(error);
  }
});

authRouter.get('/workspace', requireUser, async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({ userId: req.user._id }).lean();
    res.json({
      data: workspace ? { accounts: workspace.accounts, categories: workspace.categories, transactions: workspace.transactions, budgets: workspace.budgets, revision: workspace.revision } : { accounts: [], categories: [], transactions: [], budgets: [], revision: 0 },
      meta: { requestId: req.requestId }
    });
  } catch (error) { next(error); }
});

authRouter.put('/workspace', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const data = workspaceInput.parse(req.body);
    const workspace = await Workspace.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { ...data }, $inc: { revision: 1 } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ data: { accounts: workspace.accounts, categories: workspace.categories, transactions: workspace.transactions, budgets: workspace.budgets, revision: workspace.revision }, meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Workspace data is invalid', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});
