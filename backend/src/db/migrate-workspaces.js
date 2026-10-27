import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './connect.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '../..');
const oldImageRoot = path.join(backendDirectory, 'storage', 'transaction-images');
const userStorageRoot = path.join(backendDirectory, 'storage', 'users');
const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');
const stripLegacy = args.has('--strip-legacy');

if (stripLegacy && !commit) throw new Error('--strip-legacy requires --commit');
for (const arg of args) if (!['--commit', '--strip-legacy'].includes(arg)) throw new Error(`Unknown option: ${arg}`);

function stableUuid(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function comparableDocument(document) {
  const { _id, createdAt, updatedAt, __v, ...value } = document;
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function copyUserUploads(userId) {
  const oldDirectory = path.join(oldImageRoot, userId);
  const newDirectory = path.join(userStorageRoot, userId, 'uploads');
  let filenames = [];
  try { filenames = await readdir(oldDirectory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = [];
  for (const filename of filenames) {
    if (!/^[a-f\d-]{36}\.(?:png|jpg|webp|gif)$/i.test(filename)) continue;
    const source = path.join(oldDirectory, filename);
    const target = path.join(newDirectory, filename);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) continue;
    files.push({ source, target, filename });
  }
  return files;
}

function decodeAvatar(dataUrl, userId) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!match) throw new Error(`User ${userId} has an avatar value that is neither a supported data URL nor an empty value`);
  const [, mime, encoded] = match;
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error(`User ${userId} avatar must be non-empty and at most 5 MB`);
  const signatureValid = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : mime === 'image/gif' ? buffer.subarray(0, 4).toString('ascii') === 'GIF8'
    : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!signatureValid) throw new Error(`User ${userId} avatar bytes do not match the declared image type`);
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  const filename = `${stableUuid(buffer)}.${extension}`;
  return { buffer, filename, avatarPath: `/api/v1/auth/avatars/${filename}` };
}

async function migrate() {
  const connection = await connectDatabase();
  const db = connection.db;
  const usersCollection = db.collection('users');
  const workspacesCollection = db.collection('workspaces');
  const profileCollection = db.collection('userprofiles');
  const legacyUsers = await usersCollection.find({}, { projection: { passwordHash: 0 } }).toArray();
  const userById = new Map(legacyUsers.map((user) => [String(user._id), user]));
  const workspaces = await workspacesCollection.find({}).toArray();
  const plans = [];
  const counts = { users: legacyUsers.length, workspaces: workspaces.length, alreadyMigrated: 0, accounts: 0, categories: 0, budgets: 0, transactions: 0, uploadFiles: 0, avatars: 0 };

  for (const workspace of workspaces) {
    if (workspace.schemaVersion >= 2 && ['accounts', 'categories', 'budgets', 'transactions'].every((field) => workspace[field] === undefined)) {
      counts.alreadyMigrated += 1;
      continue;
    }
    const userId = workspace.userId;
    const userIdString = String(userId);
    const legacyUser = userById.get(userIdString);
    if (!legacyUser) throw new Error(`Workspace ${workspace._id} references missing user ${userIdString}`);
    for (const field of ['accounts', 'categories', 'budgets', 'transactions']) {
      if (workspace[field] !== undefined && !Array.isArray(workspace[field])) throw new Error(`Workspace ${workspace._id}.${field} is not an array`);
    }
    const accounts = workspace.accounts || [];
    const categories = workspace.categories || [];
    const budgets = workspace.budgets || [];
    const transactions = workspace.transactions || [];
    const accountIds = new Set(accounts.map((item) => item.id));
    const categoryById = new Map(categories.map((item) => [item.id, item]));
    if (accounts.some((item) => typeof item.id !== 'string') || categories.some((item) => typeof item.id !== 'string') || budgets.some((item) => typeof item.id !== 'string') || transactions.some((item) => typeof item.id !== 'string')) {
      throw new Error(`Workspace ${workspace._id} contains a record without a current-format string id`);
    }
    for (const account of accounts) {
      if (!account.name || !account.currency || typeof account.openingBalance !== 'string') throw new Error(`Account ${account.id} is missing required current-format fields`);
    }
    const budgetCategoryIds = new Set();
    for (const budget of budgets) {
      if (!budget.categoryId || categoryById.get(budget.categoryId)?.type !== 'expense') throw new Error(`Budget ${budget.id} has no valid expense category`);
      if (!budget.name?.trim() || typeof budget.amount !== 'string' || !budget.currency) throw new Error(`Budget ${budget.id} is missing required current-format fields`);
      if (budgetCategoryIds.has(budget.categoryId)) throw new Error(`Workspace ${workspace._id} has more than one budget for category ${budget.categoryId}`);
      budgetCategoryIds.add(budget.categoryId);
    }
    for (const transaction of transactions) {
      const category = categoryById.get(transaction.categoryId);
      if (!category || category.type !== transaction.type) throw new Error(`Transaction ${transaction.id} has a missing or mismatched category`);
      if (!transaction.title?.trim() || typeof transaction.amount !== 'string' || !transaction.currency || !transaction.transactionDate) throw new Error(`Transaction ${transaction.id} is missing required current-format fields`);
      if (transaction.accountId && !accountIds.has(transaction.accountId)) throw new Error(`Transaction ${transaction.id} references missing account ${transaction.accountId}`);
    }

    const targets = {
      accounts: accounts.map((item, sortOrder) => ({ ...item, userId, sortOrder })),
      categories: categories.map((item, sortOrder) => ({ ...item, archived: Boolean(item.archived), userId, sortOrder })),
      budgets: budgets.map((item, sortOrder) => ({ ...item, color: item.color || '#557b63', userId, sortOrder })),
      transactions: transactions.map((item, sortOrder) => ({ ...item, userId, sortOrder }))
    };
    const collectionNames = { accounts: 'accounts', categories: 'categories', budgets: 'budgets', transactions: 'transactions' };
    for (const [kind, records] of Object.entries(targets)) {
      counts[kind] += records.length;
      const targetCollection = db.collection(collectionNames[kind]);
      const recordsWithoutId = await targetCollection.find({ userId, $or: [{ id: { $exists: false } }, { id: null }] }).toArray();
      if (kind !== 'categories' && recordsWithoutId.length) {
        throw new Error(`${collectionNames[kind]} contains ${recordsWithoutId.length} legacy record(s) without a stable id for user ${userIdString}; resolve these before creating the new indexes`);
      }
      if (kind === 'categories') {
        const incomingNames = new Set(records.map((record) => `${record.type}\u0000${record.name}`));
        const unmatched = recordsWithoutId.find((record) => !incomingNames.has(`${record.type}\u0000${record.name}`));
        if (unmatched) throw new Error(`Legacy category ${unmatched.type}/${unmatched.name} for user ${userIdString} is not represented in the workspace; add or remove it before migration`);
      }
      for (const record of records) {
        const existing = await targetCollection.findOne({ userId, id: record.id });
        if (existing && stableJson(comparableDocument(existing)) !== stableJson(comparableDocument(record))) {
          throw new Error(`Conflict: ${collectionNames[kind]} already contains different data for user ${userIdString}, id ${record.id}`);
        }
        if (kind === 'categories') {
          const sameName = await targetCollection.findOne({ userId, type: record.type, name: record.name, id: { $ne: record.id } });
          if (sameName?.id && sameName.id !== record.id) throw new Error(`Category name conflict for user ${userIdString}: ${record.type}/${record.name}`);
        } else if (kind === 'budgets') {
          const sameCategory = await targetCollection.findOne({ userId, categoryId: record.categoryId, id: { $ne: record.id } });
          if (sameCategory) throw new Error(`Budget conflict for user ${userIdString}: category ${record.categoryId} already has a different budget`);
        }
      }
    }

    const existingProfile = await profileCollection.findOne({ userId });
    let profile = {
      userId,
      username: legacyUser.username || 'Default User',
      avatarPath: '',
      baseCurrency: legacyUser.baseCurrency || 'USD',
      timezone: legacyUser.timezone || 'UTC',
      emailAlertsEnabled: Boolean(legacyUser.emailAlertsEnabled)
    };
    let avatarFile = null;
    const legacyAvatar = legacyUser.avatar || '';
    if (legacyAvatar.startsWith('data:')) {
      avatarFile = decodeAvatar(legacyAvatar, userIdString);
      profile.avatarPath = avatarFile.avatarPath;
    } else if (legacyAvatar) {
      throw new Error(`User ${userIdString} avatar is not a supported data URL`);
    }
    if (existingProfile) {
      if (existingProfile.avatarPath && !legacyAvatar) profile.avatarPath = existingProfile.avatarPath;
      if (stableJson(comparableDocument(existingProfile)) !== stableJson(comparableDocument(profile))) {
        throw new Error(`Conflict: userprofiles already contains different profile data for user ${userIdString}`);
      }
    }
    const uploadFiles = await copyUserUploads(userIdString);
    counts.uploadFiles += uploadFiles.length;
    if (avatarFile) counts.avatars += 1;
    plans.push({ userId, userIdString, targets, profile, existingProfile, avatarFile, uploadFiles, legacyUser, workspace, collectionNames });
  }

  const usersWithWorkspace = new Set(workspaces.map((workspace) => String(workspace.userId)));
  for (const legacyUser of legacyUsers) {
    const userIdString = String(legacyUser._id);
    if (usersWithWorkspace.has(userIdString)) continue;
    const userId = legacyUser._id;
    const existingProfile = await profileCollection.findOne({ userId });
    let profile = {
      userId,
      username: legacyUser.username || 'Default User',
      avatarPath: '',
      baseCurrency: legacyUser.baseCurrency || 'USD',
      timezone: legacyUser.timezone || 'UTC',
      emailAlertsEnabled: Boolean(legacyUser.emailAlertsEnabled)
    };
    let avatarFile = null;
    if (legacyUser.avatar) {
      if (!legacyUser.avatar.startsWith('data:')) throw new Error(`User ${userIdString} avatar is not a supported data URL`);
      avatarFile = decodeAvatar(legacyUser.avatar, userIdString);
      profile.avatarPath = avatarFile.avatarPath;
      counts.avatars += 1;
    }
    if (existingProfile && ['username', 'avatar', 'baseCurrency', 'timezone', 'emailAlertsEnabled'].every((field) => legacyUser[field] === undefined)) {
      profile = comparableDocument(existingProfile);
    }
    if (existingProfile && stableJson(comparableDocument(existingProfile)) !== stableJson(comparableDocument(profile))) {
      throw new Error(`Conflict: userprofiles already contains different profile data for user ${userIdString}`);
    }
    const uploadFiles = await copyUserUploads(userIdString);
    counts.uploadFiles += uploadFiles.length;
    plans.push({ userId, userIdString, targets: { accounts: [], categories: [], budgets: [], transactions: [] }, profile, existingProfile, avatarFile, uploadFiles, legacyUser, workspace: null, collectionNames: { accounts: 'accounts', categories: 'categories', budgets: 'budgets', transactions: 'transactions' } });
  }

  console.log(`${commit ? 'COMMIT' : 'DRY RUN'}: ${counts.users} users, ${counts.workspaces} workspaces (${counts.alreadyMigrated} already migrated), ${counts.accounts} accounts, ${counts.categories} categories, ${counts.budgets} budgets, ${counts.transactions} transactions; ${counts.uploadFiles} legacy uploads and ${counts.avatars} avatars.`);
  if (!commit) {
    console.log('No database documents or files were changed. Review the plan, then run with --commit.');
    return;
  }

  for (const plan of plans) {
    const { userId, userIdString, targets, profile, existingProfile, avatarFile, uploadFiles, legacyUser, workspace, collectionNames } = plan;
    const uploadsDirectory = path.join(userStorageRoot, userIdString, 'uploads');
    const avatarsDirectory = path.join(userStorageRoot, userIdString, 'avatars');
    await Promise.all([mkdir(uploadsDirectory, { recursive: true }), mkdir(avatarsDirectory, { recursive: true })]);
    for (const file of uploadFiles) {
      const targetExists = await readFile(file.target).then(() => true).catch((error) => { if (error.code === 'ENOENT') return false; throw error; });
      if (!targetExists) await copyFile(file.source, file.target);
    }
    if (avatarFile) {
      const filename = path.basename(avatarFile.avatarPath).replace('/api/v1/auth/avatars/', '');
      const target = path.join(avatarsDirectory, filename);
      const exists = await readFile(target).then(() => true).catch((error) => { if (error.code === 'ENOENT') return false; throw error; });
      if (!exists) await writeFile(target, avatarFile.buffer, { flag: 'wx' });
    }
    for (const [kind, records] of Object.entries(targets)) {
      const collection = db.collection(collectionNames[kind]);
      for (const record of records) {
        for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
        if (kind === 'categories') {
          const byId = await collection.findOne({ userId, id: record.id });
          const existing = byId || await collection.findOne({ userId, type: record.type, name: record.name });
          if (existing) await collection.updateOne({ _id: existing._id }, { $set: record });
          else await collection.insertOne(record);
        } else {
          await collection.updateOne({ userId, id: record.id }, { $set: record }, { upsert: true });
        }
      }
    }
    if (existingProfile) await profileCollection.updateOne({ _id: existingProfile._id }, { $set: profile });
    else await profileCollection.insertOne(profile);
    if (workspace) {
      await db.collection('workspaces').updateOne({ _id: workspace._id }, { $set: { schemaVersion: 2 } });
      if (stripLegacy) await db.collection('workspaces').updateOne({ _id: workspace._id }, { $unset: { accounts: '', categories: '', budgets: '', transactions: '' } });
    }
    if (stripLegacy) {
      await usersCollection.updateOne({ _id: legacyUser._id }, { $unset: { username: '', avatar: '', baseCurrency: '', timezone: '', emailAlertsEnabled: '' } });
    }
  }
  console.log(`Migration finished. Legacy source files remain in ${oldImageRoot} for rollback.`);
}

try {
  await migrate();
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
