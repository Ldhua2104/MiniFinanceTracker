import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { User, UserProfile, Account, Category, IncomeSource, Transaction, Budget, Notification, EmailJob, AiAnalysis, AiSettings, EmailVerification } from '../models/index.js';

const definitions = [
  [User, { bsonType: 'object', required: ['email', 'passwordHash', 'role', 'status'], properties: {
    email: { bsonType: 'string', maxLength: 254 }, passwordHash: { bsonType: 'string' },
    role: { enum: ['user', 'admin'] }, status: { enum: ['active', 'disabled'] }, sessionVersion: { bsonType: ['int', 'long'], minimum: 0 }
  } }],
  [UserProfile, { bsonType: 'object', required: ['userId', 'username', 'baseCurrency', 'timezone'], properties: {
    userId: { bsonType: 'objectId' }, username: { bsonType: 'string', maxLength: 60 }, avatarPath: { bsonType: 'string', maxLength: 180 },
    baseCurrency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, timezone: { bsonType: 'string', maxLength: 64 }, emailAlertsEnabled: { bsonType: 'bool' }
  } }],
  [Account, { bsonType: 'object', required: ['userId', 'id', 'name', 'currency', 'openingBalance'], properties: {
    userId: { bsonType: 'objectId' }, id: { bsonType: 'string', maxLength: 80 }, name: { bsonType: 'string', maxLength: 60 },
    note: { bsonType: 'string', maxLength: 500 },
    currency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, openingBalance: { bsonType: 'string', pattern: '^\\d{1,16}(?:\\.\\d{1,2})?$' }
  } }],
  [Category, { bsonType: 'object', required: ['userId', 'id', 'name', 'type'], properties: {
    userId: { bsonType: 'objectId' }, id: { bsonType: 'string', maxLength: 80 }, name: { bsonType: 'string', maxLength: 50 },
    type: { enum: ['expense'] }, archived: { bsonType: 'bool' }, color: { bsonType: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, sortOrder: { bsonType: ['int', 'long', 'double'], minimum: 0 }
  } }],
  [IncomeSource, { bsonType: 'object', required: ['userId', 'id', 'name'], properties: {
    userId: { bsonType: 'objectId' }, id: { bsonType: 'string', maxLength: 80 }, name: { bsonType: 'string', maxLength: 50 },
    archived: { bsonType: 'bool' }, archivedAt: { bsonType: ['date', 'null'] }, color: { bsonType: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, sortOrder: { bsonType: ['int', 'long', 'double'], minimum: 0 }
  } }],
  [Transaction, { bsonType: 'object', required: ['userId', 'id', 'categoryId', 'type', 'amount', 'currency', 'title', 'transactionDate'], properties: {
    userId: { bsonType: 'objectId' }, id: { bsonType: 'string', maxLength: 80 }, categoryId: { bsonType: 'string', maxLength: 80 }, accountId: { bsonType: ['string', 'null'] }, type: { enum: ['income', 'expense'] },
    amount: { bsonType: 'string', pattern: '^\\d{1,16}(?:\\.\\d{1,2})?$' }, currency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, transactionDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    transactionTime: { bsonType: 'string', pattern: '^(?:|(?:[01]\\d|2[0-3]):[0-5]\\d)$' }, title: { bsonType: 'string', maxLength: 100 }, note: { bsonType: 'string', maxLength: 500 },
    noteImage: { bsonType: 'string', maxLength: 180 }, recurring: { bsonType: 'object' }, sortOrder: { bsonType: ['int', 'long', 'double'], minimum: 0 }
  } }],
  [Budget, { bsonType: 'object', required: ['userId', 'id', 'name', 'categoryId', 'amount', 'currency', 'color'], properties: {
    userId: { bsonType: 'objectId' }, id: { bsonType: 'string', maxLength: 80 }, name: { bsonType: 'string', maxLength: 60 }, categoryId: { bsonType: 'string', maxLength: 80 },
    amount: { bsonType: 'string', pattern: '^\\d{1,16}(?:\\.\\d{1,2})?$' }, currency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, color: { bsonType: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, sortOrder: { bsonType: ['int', 'long', 'double'], minimum: 0 }
  } }],
  [Notification, { bsonType: 'object', required: ['userId', 'threshold', 'snapshot'], properties: {
    userId: { bsonType: 'objectId' }, budgetId: { bsonType: ['objectId', 'null'] }, threshold: { enum: [80, 100] }, snapshot: { bsonType: 'object' }, readAt: { bsonType: ['date', 'null'] }
  } }],
  [EmailJob, { bsonType: 'object', required: ['notificationId', 'status', 'attempts', 'idempotencyKey'], properties: {
    notificationId: { bsonType: 'objectId' }, status: { enum: ['pending', 'processing', 'accepted', 'failed', 'skipped'] }, attempts: { bsonType: 'int', minimum: 0, maximum: 3 }, idempotencyKey: { bsonType: 'string' }
  } }],
  [AiAnalysis, { bsonType: 'object', required: ['userId', 'month', 'dataRevision', 'status', 'inputSummary'], properties: {
    userId: { bsonType: 'objectId' }, month: { bsonType: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }, dataRevision: { bsonType: ['int', 'long'], minimum: 0 }, status: { enum: ['pending', 'processing', 'completed', 'failed'] }, inputSummary: { bsonType: 'object' }
  } }],
  [AiSettings, { bsonType: 'object', required: ['userId', 'encryptedSettings'], properties: {
    userId: { bsonType: 'objectId' }, encryptedSettings: { bsonType: 'object', required: ['ciphertext', 'iv', 'authTag', 'keyVersion'], properties: {
      ciphertext: { bsonType: 'string' }, iv: { bsonType: 'string' }, authTag: { bsonType: 'string' }, keyVersion: { bsonType: ['int', 'long', 'double'], minimum: 1 }
    } }
  } }],
  [EmailVerification, { bsonType: 'object', required: ['userId', 'codeHash', 'expiresAt', 'attempts'], properties: {
    userId: { bsonType: 'objectId' }, codeHash: { bsonType: 'string' }, expiresAt: { bsonType: 'date' }, attempts: { bsonType: 'int', minimum: 0, maximum: 5 }, consumedAt: { bsonType: ['date', 'null'] }
  } }],
];
const validatorsOnly = process.argv.includes('--validators-only');
const unknownOptions = process.argv.slice(2).filter((argument) => argument !== '--validators-only');
if (unknownOptions.length) throw new Error(`Unknown option(s): ${unknownOptions.join(', ')}`);

try {
  const connection = await connectDatabase();
  for (const [Model, validator] of definitions) {
    const collectionName = Model.collection.collectionName;
    const exists = await connection.db.listCollections({ name: collectionName }).hasNext();
    if (!exists) await connection.db.createCollection(collectionName);
    await connection.db.command({
      collMod: collectionName,
      validator: { $jsonSchema: { bsonType: 'object', ...validator } },
      validationLevel: 'strict',
      validationAction: 'error'
    });
    if (!validatorsOnly) await Model.createIndexes();
    console.log(`${validatorsOnly ? 'Validated' : 'Initialized'} ${collectionName}`);
  }
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
