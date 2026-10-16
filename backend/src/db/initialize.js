import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { User, Category, Transaction, Budget, Notification, EmailJob, AiAnalysis, EmailVerification, Workspace } from '../models/index.js';

const definitions = [
  [User, { bsonType: 'object', required: ['email', 'passwordHash', 'role', 'status', 'baseCurrency'], properties: {
    email: { bsonType: 'string', maxLength: 254 }, passwordHash: { bsonType: 'string' },
    role: { enum: ['user', 'admin'] }, status: { enum: ['active', 'disabled'] }, baseCurrency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }
  } }],
  [Category, { bsonType: 'object', required: ['userId', 'name', 'type'], properties: {
    userId: { bsonType: 'objectId' }, name: { bsonType: 'string', maxLength: 50 }, type: { enum: ['income', 'expense'] }, archivedAt: { bsonType: ['date', 'null'] }
  } }],
  [Transaction, { bsonType: 'object', required: ['userId', 'categoryId', 'type', 'amount', 'currency', 'transactionDate', 'fxRate', 'fxDate', 'baseCurrency', 'baseAmount'], properties: {
    userId: { bsonType: 'objectId' }, categoryId: { bsonType: 'objectId' }, type: { enum: ['income', 'expense'] },
    amount: { bsonType: 'decimal' }, currency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, transactionDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    fxRate: { bsonType: 'decimal' }, fxDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, baseCurrency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }, baseAmount: { bsonType: 'decimal' }
  } }],
  [Budget, { bsonType: 'object', required: ['userId', 'categoryId', 'month', 'amount', 'currency'], properties: {
    userId: { bsonType: 'objectId' }, categoryId: { bsonType: 'objectId' }, month: { bsonType: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }, amount: { bsonType: 'decimal' }, currency: { enum: ['USD', 'EUR', 'CNY', 'GBP'] }
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
  [EmailVerification, { bsonType: 'object', required: ['userId', 'codeHash', 'expiresAt', 'attempts'], properties: {
    userId: { bsonType: 'objectId' }, codeHash: { bsonType: 'string' }, expiresAt: { bsonType: 'date' }, attempts: { bsonType: 'int', minimum: 0, maximum: 5 }, consumedAt: { bsonType: ['date', 'null'] }
  } }],
  [Workspace, { bsonType: 'object', required: ['userId'], properties: {
    userId: { bsonType: 'objectId' }, accounts: { bsonType: 'array' }, categories: { bsonType: 'array' }, transactions: { bsonType: 'array' }, budgets: { bsonType: 'array' }, revision: { bsonType: ['int', 'long'], minimum: 0 }
  } }]
];

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
    await Model.createIndexes();
    console.log(`Initialized ${collectionName}`);
  }
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
