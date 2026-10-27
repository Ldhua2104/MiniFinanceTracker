import mongoose from 'mongoose';
import argon2 from 'argon2';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { User, UserProfile, Category, IncomeSource } from '../models/index.js';
import { randomUUID } from 'node:crypto';

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running db:seed');
}

try {
  await connectDatabase();
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await argon2.hash(env.ADMIN_PASSWORD);
  const user = await User.findOneAndUpdate(
    { email },
    { $setOnInsert: { email, passwordHash, role: 'admin', status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await UserProfile.updateOne(
    { userId: user._id },
    { $setOnInsert: { userId: user._id, username: 'Administrator', baseCurrency: 'USD', timezone: 'UTC', emailAlertsEnabled: false } },
    { upsert: true }
  );
  const starterCategories = [
    { userId: user._id, name: 'Food', type: 'expense' },
    { userId: user._id, name: 'Transport', type: 'expense' },
    { userId: user._id, name: 'Housing', type: 'expense' }
  ];
  const starterIncomeSources = [
    { userId: user._id, name: 'Salary' },
    { userId: user._id, name: 'Bonus' },
    { userId: user._id, name: 'Other' }
  ];
  for (const [sortOrder, category] of starterCategories.entries()) {
    const existing = await Category.findOne({ userId: user._id, type: category.type, name: category.name });
    if (existing) {
      if (!existing.id) await Category.updateOne({ _id: existing._id }, { $set: { id: randomUUID(), archived: false, sortOrder } });
      continue;
    }
    await Category.create({ ...category, id: randomUUID(), archived: false, sortOrder });
  }
  for (const [sortOrder, source] of starterIncomeSources.entries()) {
    const existing = await IncomeSource.findOne({ userId: user._id, name: source.name });
    if (existing) {
      if (!existing.id) await IncomeSource.updateOne({ _id: existing._id }, { $set: { id: randomUUID(), archived: false, sortOrder } });
      continue;
    }
    await IncomeSource.create({ ...source, id: randomUUID(), archived: false, sortOrder });
  }
  console.log(`Seeded administrator ${email}, starter categories and income sources`);
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
