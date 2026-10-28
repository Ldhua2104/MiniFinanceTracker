import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { Account, AiSettings, Budget, Category, IncomeSource, Transaction, User, UserProfile } from '../models/index.js';
import { MAX_IMAGE_BYTES, profileInput, registerInput } from '../domain/validation.js';
import { CURRENCIES } from '../domain/constants.js';
import { requireCsrf } from '../middleware/csrf.js';
import { requireUser, SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions, clearSessionCookieOptions, csrfCookieOptions, signSession, verifySessionToken } from '../middleware/auth.js';
import { decryptAiSettings, encryptAiSettings } from '../services/ai-settings-crypto.js';
import { isAiProbeRetryable, probeAiModel, streamAiChat } from '../services/ai-probe.js';

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  next();
});
const userStorageRoot = fileURLToPath(new URL('../../storage/users/', import.meta.url));
const assistantPromptFile = fileURLToPath(new URL('../prompts/assistant-system.md', import.meta.url));
const userStorageDirectory = (userId, area) => path.join(userStorageRoot, String(userId), area);
const avatarPathPattern = /^\/api\/v1\/auth\/avatars\/([a-f\d-]{36})\.(png|jpg|webp|gif)$/i;
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
  schedule: z.enum(['month-start', 'month-end', 'same-day', 'custom']).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).strict().superRefine((rule, context) => {
  if (!rule.enabled) return;
  if (!rule.schedule || !rule.time || !rule.nextRunDate) context.addIssue({ code: 'custom', message: 'Enabled recurring transactions require a schedule, time and next run date' });
  if (['custom', 'same-day'].includes(rule.schedule) && !rule.dayOfMonth) context.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'This recurrence requires a day of month' });
});
const aiSettingsInput = z.object({
  providers: z.array(z.object({
    id: z.string().min(1).max(80),
    type: z.enum(['openai', 'anthropic', 'gemini', 'compatible']),
    endpoint: z.string().max(500).default('')
  }).strict()).max(20),
  models: z.array(z.object({
    id: z.string().min(1).max(80),
    providerId: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    customName: z.string().trim().max(120).optional().default('')
  }).strict()).max(100),
  assignments: z.object({
    receipt: z.string().max(80).default(''),
    conversation: z.string().max(80).default('')
  }).strict(),
  apiKeys: z.record(z.string().max(80), z.string().max(4096)).default({}),
  clearApiKeys: z.array(z.string().max(80)).max(20).default([])
}).strict().superRefine((settings, context) => {
  const providerIds = new Set(settings.providers.map((provider) => provider.id));
  const modelIds = new Set(settings.models.map((model) => model.id));
  if (providerIds.size !== settings.providers.length) context.addIssue({ code: 'custom', path: ['providers'], message: 'Provider ids must be unique' });
  if (modelIds.size !== settings.models.length) context.addIssue({ code: 'custom', path: ['models'], message: 'Model ids must be unique' });
  settings.models.forEach((model, index) => {
    if (!providerIds.has(model.providerId)) context.addIssue({ code: 'custom', path: ['models', index, 'providerId'], message: 'Model provider does not exist' });
  });
  Object.entries(settings.assignments).forEach(([task, modelId]) => {
    if (modelId && !modelIds.has(modelId)) context.addIssue({ code: 'custom', path: ['assignments', task], message: 'Assigned model does not exist' });
  });
  Object.keys(settings.apiKeys).forEach((providerId) => {
    if (!providerIds.has(providerId)) context.addIssue({ code: 'custom', path: ['apiKeys', providerId], message: 'API key provider does not exist' });
  });
});

const workspaceInput = z.object({
  accounts: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60),
    note: z.string().max(500).optional().default(''), currency: z.enum(CURRENCIES), openingBalance: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  }).strict()).max(100),
  categories: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(50),
    type: z.enum(['income', 'expense']), archived: z.boolean().default(false), color: z.string().regex(/^#[\da-fA-F]{6}$/).optional()
  }).strict()).max(500),
  transactions: z.array(z.object({
    id: z.string().min(1).max(80), type: z.enum(['income', 'expense']),
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => new Decimal(value).gt(0)), currency: z.enum(CURRENCIES),
    title: z.string().trim().min(1).max(100),
    categoryId: z.string().min(1).max(80), transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    transactionTime: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().default(''),
    note: z.string().max(500).default(''), noteImage: z.union([z.literal(''), transactionImagePath]).optional().default(''),
    accountId: z.string().min(1).max(80).nullable().optional(), recurring: recurringInput.optional(),
    recurrenceSourceId: z.string().min(1).max(80).optional(), recurrenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
  }).strict()).max(10000),
  budgets: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60),
    categoryId: z.string().min(1).max(80),
    amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => new Decimal(value).gt(0)),
    currency: z.enum(CURRENCIES),
    color: z.string().regex(/^#[\da-fA-F]{6}$/).optional().default('#557b63')
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
  for (const [index, category] of workspace.categories.entries()) {
    if (workspace.categories.slice(0, index).some((item) => item.type === category.type && item.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) {
      context.addIssue({ code: 'custom', path: ['categories', index, 'name'], message: 'Category names must be unique within their type' });
    }
  }
  for (const [index, budget] of workspace.budgets.entries()) {
    if (workspace.budgets.slice(0, index).some((item) => item.categoryId === budget.categoryId)) {
      context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Only one budget can be assigned to each category' });
    }
  }
  const accountIds = new Set(workspace.accounts.map((account) => account.id));
  const categoryIds = new Set(workspace.categories.map((category) => category.id));
  const categoryById = new Map(workspace.categories.map((category) => [category.id, category]));
  workspace.transactions.forEach((transaction, index) => {
    if (transaction.accountId && !accountIds.has(transaction.accountId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'accountId'], message: 'Account does not exist in this workspace' });
    if (!categoryIds.has(transaction.categoryId)) context.addIssue({ code: 'custom', path: ['transactions', index, 'categoryId'], message: 'Category does not exist in this workspace' });
    if (categoryIds.has(transaction.categoryId) && categoryById.get(transaction.categoryId)?.type !== transaction.type) context.addIssue({ code: 'custom', path: ['transactions', index, 'categoryId'], message: 'Transaction category type must match the transaction type' });
  });
  workspace.budgets.forEach((budget, index) => {
    if (budget.categoryId && !categoryIds.has(budget.categoryId)) context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Category does not exist in this workspace' });
    if (budget.categoryId && categoryById.get(budget.categoryId)?.type !== 'expense') context.addIssue({ code: 'custom', path: ['budgets', index, 'categoryId'], message: 'Budgets must use an expense category' });
  });
});

async function publicUser(user) {
  const profile = await UserProfile.findOne({ userId: user._id }).lean();
  return {
    id: user.id,
    email: user.email,
    username: profile?.username || 'Default User',
    avatar: profile?.avatarPath || '',
    role: user.role,
    status: user.status,
    baseCurrency: profile?.baseCurrency || 'USD',
    timezone: profile?.timezone || 'UTC',
    emailVerified: Boolean(user.emailVerifiedAt),
    emailAlertsEnabled: profile?.emailAlertsEnabled || false
  };
}

async function ensureUserFolders(userId) {
  await Promise.all(['uploads', 'avatars'].map((area) => mkdir(userStorageDirectory(userId, area), { recursive: true })));
}

function imageSignatureIsValid(mime, buffer) {
  return mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : mime === 'image/gif' ? buffer.subarray(0, 4).toString('ascii') === 'GIF8'
    : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function parseAvatarImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw Object.assign(new Error('Avatar must be a supported image data URL'), { code: 'INVALID_AVATAR' });
  const [, mime, encoded] = match;
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Avatar must be 5 MB or smaller'), { code: 'IMAGE_TOO_LARGE' });
  if (!imageSignatureIsValid(mime, buffer)) throw Object.assign(new Error('The uploaded avatar is not a supported image'), { code: 'INVALID_AVATAR' });
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  return { buffer, extension };
}

async function storeAvatar(userId, dataUrl) {
  const { buffer, extension } = parseAvatarImage(dataUrl);
  const filename = `${randomUUID()}.${extension}`;
  await mkdir(userStorageDirectory(userId, 'avatars'), { recursive: true });
  await writeFile(path.join(userStorageDirectory(userId, 'avatars'), filename), buffer, { flag: 'wx' });
  return `/api/v1/auth/avatars/${filename}`;
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
    const validSignature = imageSignatureIsValid(mime, buffer);
    if (!validSignature) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'The uploaded file is not a supported image' }, meta: { requestId: req.requestId } });
    }
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
    const filename = `${randomUUID()}.${extension}`;
    const userDirectory = userStorageDirectory(req.user.id, 'uploads');
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
    const image = await readFile(path.join(userStorageDirectory(req.user.id, 'uploads'), req.params.filename));
    const extension = path.extname(req.params.filename).toLowerCase();
    const mime = extension === '.jpg' ? 'image/jpeg' : `image/${extension.slice(1)}`;
    res.set('Cache-Control', 'private, max-age=3600').set('X-Content-Type-Options', 'nosniff').type(mime).send(image);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).end();
    next(error);
  }
});

authRouter.get('/avatars/:filename', requireUser, async (req, res, next) => {
  if (!/^[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i.test(req.params.filename)) return res.status(404).end();
  try {
    const profile = await UserProfile.findOne({ userId: req.user._id }).lean();
    if (profile?.avatarPath !== `/api/v1/auth/avatars/${req.params.filename}`) return res.status(404).end();
    const image = await readFile(path.join(userStorageDirectory(req.user.id, 'avatars'), req.params.filename));
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
    if (input.avatar) parseAvatarImage(input.avatar);
    const passwordHash = await argon2.hash(input.password);
    const user = await User.create({
      email: input.email,
      passwordHash,
      role: 'user',
      status: 'active'
    });
    await ensureUserFolders(user._id);
    const avatarPath = input.avatar ? await storeAvatar(user._id, input.avatar) : '';
    await UserProfile.create({ userId: user._id, username: input.username, avatarPath, baseCurrency: input.baseCurrency, timezone: input.timezone });
    sendSession(res, user);
    res.status(201).json({ data: await publicUser(user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' }, meta: { requestId: req.requestId } });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    if (error.code === 'IMAGE_TOO_LARGE' || error.code === 'INVALID_AVATAR') {
      return res.status(400).json({ error: { code: error.code, message: error.message }, meta: { requestId: req.requestId } });
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
    res.json({ data: await publicUser(user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

authRouter.get('/me', requireUser, async (req, res, next) => {
  try { res.json({ data: await publicUser(req.user), meta: { requestId: req.requestId } }); }
  catch (error) { next(error); }
});

authRouter.patch('/profile', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const input = profileInput.parse(req.body);
    await ensureUserFolders(req.user._id);
    const current = await UserProfile.findOne({ userId: req.user._id });
    let avatarPath = input.avatar;
    if (input.avatar.startsWith('data:')) avatarPath = await storeAvatar(req.user._id, input.avatar);
    else if (input.avatar && input.avatar !== current?.avatarPath) return res.status(400).json({ error: { code: 'INVALID_AVATAR', message: 'Avatar path does not belong to this user' }, meta: { requestId: req.requestId } });
    const previousAvatarPath = current?.avatarPath;
    await UserProfile.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { username: input.username, avatarPath } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (previousAvatarPath && previousAvatarPath !== avatarPath) {
      const previous = avatarPathPattern.exec(previousAvatarPath);
      if (previous) await unlink(path.join(userStorageDirectory(req.user.id, 'avatars'), `${previous[1]}.${previous[2]}`)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    res.json({ data: await publicUser(req.user), meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted fields', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    if (error.code === 'IMAGE_TOO_LARGE' || error.code === 'INVALID_AVATAR') {
      return res.status(400).json({ error: { code: error.code, message: error.message }, meta: { requestId: req.requestId } });
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

authRouter.get('/data', requireUser, async (req, res, next) => {
  try {
    const [accounts, expenseCategories, incomeSources, transactions, budgets] = await Promise.all([
      Account.find({ userId: req.user._id }).sort({ sortOrder: 1, _id: 1 }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
      Category.find({ userId: req.user._id, type: 'expense' }).sort({ sortOrder: 1, _id: 1 }).select('-_id -userId -createdAt -updatedAt -archivedAt').lean(),
      IncomeSource.find({ userId: req.user._id }).sort({ sortOrder: 1, _id: 1 }).select('-_id -userId -createdAt -updatedAt -archivedAt').lean(),
      Transaction.find({ userId: req.user._id }).sort({ sortOrder: 1, _id: 1 }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean(),
      Budget.find({ userId: req.user._id }).sort({ sortOrder: 1, _id: 1 }).select('-_id -userId -createdAt -updatedAt -sortOrder').lean()
    ]);
    const categories = [
      ...expenseCategories,
      ...incomeSources.map(({ sortOrder, ...source }) => ({ ...source, type: 'income', sortOrder }))
    ].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(({ sortOrder, ...category }) => category);
    res.json({
      data: { accounts, categories, transactions, budgets },
      meta: { requestId: req.requestId }
    });
  } catch (error) { next(error); }
});

async function replaceUserItems(Model, userId, items, scope = {}) {
  if (items.length) {
    await Model.bulkWrite(items.map((item, sortOrder) => ({
      replaceOne: {
        filter: { ...scope, userId, id: item.id },
        replacement: { ...item, userId, sortOrder: item.sortOrder ?? sortOrder },
        upsert: true
      }
    })), { ordered: true });
  }
  await Model.deleteMany({ ...scope, userId, ...(items.length ? { id: { $nin: items.map((item) => item.id) } } : {}) });
}

authRouter.put('/data', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const data = workspaceInput.parse(req.body);
    await replaceUserItems(Account, req.user._id, data.accounts);
    const expenseCategories = [];
    const incomeSources = [];
    data.categories.forEach((category, sortOrder) => {
      if (category.type === 'income') {
        const { type: _type, ...source } = category;
        incomeSources.push({ ...source, sortOrder });
      } else {
        expenseCategories.push({ ...category, sortOrder });
      }
    });
    await replaceUserItems(Category, req.user._id, expenseCategories, { type: 'expense' });
    await replaceUserItems(IncomeSource, req.user._id, incomeSources);
    await replaceUserItems(Transaction, req.user._id, data.transactions);
    await replaceUserItems(Budget, req.user._id, data.budgets);
    res.json({ data, meta: { requestId: req.requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Finance data is invalid', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    next(error);
  }
});

const emptyAiSettings = () => ({ providers: [], models: [], assignments: { receipt: '', conversation: '' }, apiKeys: {} });

function publicAiSettings(settings) {
  return {
    providers: settings.providers.map(({ id, type, endpoint }) => ({ id, type, endpoint, hasApiKey: Boolean(settings.apiKeys[id]) })),
    models: settings.models,
    assignments: { receipt: settings.assignments.receipt || '', conversation: settings.assignments.conversation || '' }
  };
}

function parseAiSettingsRequest(req, res) {
  try {
    return aiSettingsInput.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'AI settings are invalid', fields: z.flattenError(error).fieldErrors }, meta: { requestId: req.requestId } });
      return null;
    }
    throw error;
  }
}

function sendAiSettingsError(error, req, res, next) {
  if (error.code === 'AI_ENCRYPTION_NOT_CONFIGURED') {
    return res.status(503).json({ error: { code: error.code, message: 'AI credential storage is not configured on this server' }, meta: { requestId: req.requestId } });
  }
  if (error.code === 'AI_ENCRYPTION_KEY_VERSION_UNSUPPORTED') {
    return res.status(503).json({ error: { code: error.code, message: 'Stored AI credentials require a newer encryption key version' }, meta: { requestId: req.requestId } });
  }
  return next(error);
}

async function readAiSettings(userId) {
  const record = await AiSettings.findOne({ userId }).lean();
  return record ? decryptAiSettings(record.encryptedSettings, userId) : emptyAiSettings();
}

async function writeAiSettings(userId, settings) {
  const encryptedSettings = encryptAiSettings(settings, userId);
  await AiSettings.findOneAndUpdate(
    { userId },
    { $set: { encryptedSettings } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

authRouter.get('/ai-settings', requireUser, async (req, res, next) => {
  try {
    const settings = await readAiSettings(req.user._id);
    res.json({ data: publicAiSettings(settings), meta: { requestId: req.requestId } });
  } catch (error) { sendAiSettingsError(error, req, res, next); }
});

const aiTaskProbeInput = z.object({ task: z.enum(['receipt', 'conversation']) }).strict();
const aiProbeErrorStatus = {
  AI_TEST_KEY_MISSING: 400,
  AI_TEST_ASSIGNMENT_MISSING: 400,
  AI_TEST_MODEL_NOT_FOUND: 400,
  AI_TEST_PROVIDER_NOT_FOUND: 400,
  AI_TEST_ENDPOINT_INVALID: 400,
  AI_TEST_INSECURE_ENDPOINT: 400,
  AI_TEST_ENDPOINT_BLOCKED: 400,
  AI_TEST_AUTH_FAILED: 401,
  AI_TEST_MODEL_OR_ENDPOINT_NOT_FOUND: 404,
  AI_TEST_RATE_LIMITED: 429,
  AI_TEST_TIMEOUT: 504,
  AI_TEST_PROVIDER_UNAVAILABLE: 502,
  AI_TEST_NETWORK: 502,
  AI_TEST_DNS_FAILED: 502,
  AI_TEST_REQUEST_REJECTED: 422,
  AI_TEST_REDIRECT_UNSUPPORTED: 422,
  AI_TEST_INVALID_RESPONSE: 502,
  AI_TEST_RESPONSE_TOO_LARGE: 502,
  AI_TEST_REQUEST_FAILED: 502
};

authRouter.post('/ai-settings/test', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const parsed = aiTaskProbeInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'AI_TEST_INVALID_TASK' }, meta: { requestId: req.requestId } });
    const settings = await readAiSettings(req.user._id);
    const modelId = settings.assignments?.[parsed.data.task];
    if (!modelId) return res.status(400).json({ error: { code: 'AI_TEST_ASSIGNMENT_MISSING' }, meta: { requestId: req.requestId } });
    const model = settings.models.find((item) => item.id === modelId);
    if (!model) return res.status(400).json({ error: { code: 'AI_TEST_MODEL_NOT_FOUND' }, meta: { requestId: req.requestId } });
    const provider = settings.providers.find((item) => item.id === model.providerId);
    if (!provider) return res.status(400).json({ error: { code: 'AI_TEST_PROVIDER_NOT_FOUND' }, meta: { requestId: req.requestId } });
    try {
      await probeAiModel(provider, model, settings.apiKeys[provider.id]);
      return res.json({ data: { task: parsed.data.task, success: true }, meta: { requestId: req.requestId } });
    } catch (error) {
      const code = error.code?.startsWith('AI_TEST_') ? error.code : 'AI_TEST_NETWORK';
      return res.status(aiProbeErrorStatus[code] || 502).json({ error: { code, retryable: isAiProbeRetryable(error) }, meta: { requestId: req.requestId } });
    }
  } catch (error) { sendAiSettingsError(error, req, res, next); }
});

const assistantChatInput = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(8000)
  }).strict()).min(1).max(40)
}).strict().superRefine(({ messages }, context) => {
  if (messages.at(-1)?.role !== 'user') context.addIssue({ code: 'custom', path: ['messages'], message: 'The latest chat message must come from the user' });
  if (messages.reduce((total, message) => total + message.content.length, 0) > 30000) {
    context.addIssue({ code: 'custom', path: ['messages'], message: 'The conversation is too long' });
  }
});

authRouter.post('/assistant/chat', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const parsed = assistantChatInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'AI_CHAT_INVALID_INPUT', fields: z.flattenError(parsed.error).fieldErrors }, meta: { requestId: req.requestId } });
    }
    const settings = await readAiSettings(req.user._id);
    const modelId = settings.assignments?.conversation;
    if (!modelId) return res.status(400).json({ error: { code: 'AI_CHAT_MODEL_UNASSIGNED' }, meta: { requestId: req.requestId } });
    const model = settings.models.find((item) => item.id === modelId);
    if (!model) return res.status(400).json({ error: { code: 'AI_CHAT_MODEL_NOT_FOUND' }, meta: { requestId: req.requestId } });
    const provider = settings.providers.find((item) => item.id === model.providerId);
    if (!provider) return res.status(400).json({ error: { code: 'AI_CHAT_PROVIDER_NOT_FOUND' }, meta: { requestId: req.requestId } });
    if (!settings.apiKeys[provider.id]) return res.status(400).json({ error: { code: 'AI_CHAT_KEY_MISSING' }, meta: { requestId: req.requestId } });

    const systemPrompt = (await readFile(assistantPromptFile, 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!systemPrompt) return res.status(503).json({ error: { code: 'AI_CHAT_PROMPT_UNAVAILABLE' }, meta: { requestId: req.requestId } });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...parsed.data.messages
      ];
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      await streamAiChat(provider, model, settings.apiKeys[provider.id], messages, (text) => {
        res.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`);
      }, {
        signal: controller.signal,
        onUsage: (usage) => res.write(`event: usage\ndata: ${JSON.stringify({ ...usage, modelId: model.id, modelName: model.customName || model.name })}\n\n`)
      });
      res.write(`event: done\ndata: ${JSON.stringify({ role: 'assistant', model: model.customName || model.name })}\n\n`);
      return res.end();
    } catch (error) {
      if (error.code === 'AI_CHAT_ABORTED' || controller.signal.aborted) return res.end();
      const code = error.code?.startsWith('AI_TEST_') ? error.code : 'AI_TEST_NETWORK';
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ code, retryable: isAiProbeRetryable(error), requestId: req.requestId })}\n\n`);
        return res.end();
      }
      return res.status(aiProbeErrorStatus[code] || 502).json({ error: { code, retryable: isAiProbeRetryable(error) }, meta: { requestId: req.requestId } });
    }
  } catch (error) { sendAiSettingsError(error, req, res, next); }
});

authRouter.put('/ai-settings', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const input = parseAiSettingsRequest(req, res);
    if (!input) return;
    const previous = await readAiSettings(req.user._id);
    const providers = new Set(input.providers.map((provider) => provider.id));
    const apiKeys = Object.fromEntries(Object.entries(previous.apiKeys).filter(([providerId]) => providers.has(providerId)));
    input.clearApiKeys.forEach((providerId) => { delete apiKeys[providerId]; });
    Object.entries(input.apiKeys).forEach(([providerId, apiKey]) => {
      if (apiKey.trim()) apiKeys[providerId] = apiKey.trim();
    });
    const settings = { providers: input.providers, models: input.models, assignments: input.assignments, apiKeys };
    await writeAiSettings(req.user._id, settings);
    res.json({ data: publicAiSettings(settings), meta: { requestId: req.requestId } });
  } catch (error) { sendAiSettingsError(error, req, res, next); }
});

authRouter.post('/ai-settings/migrate', requireCsrf, requireUser, async (req, res, next) => {
  try {
    const input = parseAiSettingsRequest(req, res);
    if (!input) return;
    const existing = await readAiSettings(req.user._id);
    const providerMap = new Map(existing.providers.map((provider) => [provider.id, provider]));
    input.providers.forEach((provider) => { if (!providerMap.has(provider.id)) providerMap.set(provider.id, provider); });
    const providers = [...providerMap.values()];
    const providerIds = new Set(providers.map((provider) => provider.id));
    const apiKeys = Object.fromEntries(Object.entries(existing.apiKeys).filter(([providerId]) => providerIds.has(providerId)));
    Object.entries(input.apiKeys).forEach(([providerId, apiKey]) => {
      if (!apiKeys[providerId] && providerIds.has(providerId) && apiKey.trim()) apiKeys[providerId] = apiKey.trim();
    });
    const modelMap = new Map(existing.models.map((model) => [model.id, model]));
    input.models.forEach((model) => { if (!modelMap.has(model.id) && providerIds.has(model.providerId)) modelMap.set(model.id, model); });
    const models = [...modelMap.values()];
    const modelIds = new Set(models.map((model) => model.id));
    const assignments = Object.fromEntries(['receipt', 'conversation'].map((task) => {
      const existingModel = existing.assignments?.[task];
      const incomingModel = input.assignments[task];
      return [task, existingModel && modelIds.has(existingModel) ? existingModel : (modelIds.has(incomingModel) ? incomingModel : '')];
    }));
    const settings = { providers, models, assignments, apiKeys };
    await writeAiSettings(req.user._id, settings);
    res.json({ data: publicAiSettings(settings), meta: { requestId: req.requestId } });
  } catch (error) { sendAiSettingsError(error, req, res, next); }
});

authRouter.delete('/ai-settings', requireCsrf, requireUser, async (req, res, next) => {
  try {
    await AiSettings.deleteOne({ userId: req.user._id });
    res.status(204).end();
  } catch (error) { next(error); }
});
