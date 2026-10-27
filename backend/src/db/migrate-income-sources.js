import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './connect.js';

const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');
for (const arg of args) if (arg !== '--commit') throw new Error(`Unknown option: ${arg}`);

function comparable(source) {
  const result = {
    userId: source.userId,
    id: source.id,
    name: source.name,
    archived: Boolean(source.archived),
    sortOrder: source.sortOrder ?? 0
  };
  if (source.color !== undefined) result.color = source.color;
  if (source.archivedAt !== undefined) result.archivedAt = source.archivedAt;
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function migrate() {
  const connection = await connectDatabase();
  const db = connection.db;
  const categories = db.collection('categories');
  const incomeSources = db.collection('incomesources');
  const oldIncomeCategories = await categories.find({ type: 'income' }).toArray();
  const plan = [];

  for (const oldCategory of oldIncomeCategories) {
    if (!oldCategory.userId || typeof oldCategory.id !== 'string' || !oldCategory.name?.trim()) {
      throw new Error(`Income category ${oldCategory._id} is missing userId, stable id or name`);
    }
    const nextSource = comparable(oldCategory);
    const existing = await incomeSources.findOne({ userId: oldCategory.userId, id: oldCategory.id });
    if (existing && stableJson(comparable(existing)) !== stableJson(nextSource)) {
      throw new Error(`Conflict: incomesources already contains different data for user ${oldCategory.userId}, id ${oldCategory.id}`);
    }
    const sameName = await incomeSources.findOne({ userId: oldCategory.userId, name: oldCategory.name, id: { $ne: oldCategory.id } });
    if (sameName) throw new Error(`Income source name conflict for user ${oldCategory.userId}: ${oldCategory.name}`);
    plan.push({ oldCategory, nextSource });
  }

  console.log(`${commit ? 'COMMIT' : 'DRY RUN'}: ${plan.length} income source(s) will move from categories to incomesources.`);
  if (!commit) {
    console.log('No database documents were changed. Review the plan, then run with --commit.');
    return;
  }

  for (const { oldCategory, nextSource } of plan) {
    await incomeSources.updateOne(
      { userId: oldCategory.userId, id: oldCategory.id },
      { $set: nextSource },
      { upsert: true }
    );
    await categories.deleteOne({ _id: oldCategory._id });
  }
  console.log('Income source migration finished. Expense categories remain in categories.');
}

try {
  await migrate();
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
