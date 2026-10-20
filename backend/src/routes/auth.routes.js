import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { User, Workspace } from '../models/index.js';
import { registerInput } from '../domain/validation.js';
import { CURRENCIES } from '../domain/constants.js';
import { requireCsrf } from '../middleware/csrf.js';
import { requireUser, SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions, clearSessionCookieOptions, csrfCookieOptions, signSession, verifySessionToken } from '../middleware/auth.js';

export const authRouter = Router();
const loginInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

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
    categoryId: z.string().min(1).max(80), transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(500).default(''), accountId: z.string().min(1).max(80).nullable().optional()
  }).strict()).max(10000),
  budgets: z.array(z.object({
    id: z.string().min(1).max(80), categoryId: z.string().min(1).max(80),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => new Decimal(value).gt(0)), currency: z.enum(CURRENCIES)
  }).strict()).max(1000)
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
  const categoryIds = new Set(workspace.categories.map((category) => category.id));
  workspace.transactions.forEach((transaction, index) => {
    if (transaction.accountId && !accountIds.has(transaction.accountId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'accountId'], message: 'Account does not exist in this workspace' });
    if (!categoryIds.has(transaction.categoryId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'categoryId'], message: 'Category does not exist in this workspace' });
  });
  workspace.budgets.forEach((budget, index) => {
    if (!categoryIds.has(budget.categoryId)) context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Category does not exist in this workspace' });
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
