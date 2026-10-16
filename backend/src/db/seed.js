import mongoose from 'mongoose';
import argon2 from 'argon2';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { User, Category } from '../models/index.js';

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running db:seed');
}

try {
  await connectDatabase();
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await argon2.hash(env.ADMIN_PASSWORD);
  const user = await User.findOneAndUpdate(
    { email },
    { $setOnInsert: { email, passwordHash, role: 'admin', status: 'active', baseCurrency: 'USD', timezone: 'UTC' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const starterCategories = [
    { userId: user._id, name: 'Salary', type: 'income' },
    { userId: user._id, name: 'Food', type: 'expense' },
    { userId: user._id, name: 'Transport', type: 'expense' },
    { userId: user._id, name: 'Housing', type: 'expense' }
  ];
  for (const category of starterCategories) {
    await Category.updateOne({ userId: user._id, type: category.type, name: category.name }, { $setOnInsert: category }, { upsert: true });
  }
  console.log(`Seeded administrator ${email} and starter categories`);
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
