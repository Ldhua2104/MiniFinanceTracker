import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Transaction, User } from '../models/index.js';
import { requireAdmin, requireUser } from '../middleware/auth.js';
import { requireCsrf } from '../middleware/csrf.js';

export const adminRouter = Router();
const CHART_DAYS = 30;
const ACTIVE_STREAK_DAYS = 3;

function addUtcDays(date, amount) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function maskEmail(email) {
  const [localPart, domain] = String(email).split('@');
  if (!localPart || !domain) return '****';
  if (localPart.length === 1) return `****@${domain}`;
  return `${localPart[0]}****${localPart.length > 3 ? localPart.at(-1) : ''}@${domain}`;
}

adminRouter.use(requireUser, requireAdmin);

adminRouter.get('/overview', async (req, res, next) => {
  try {
    const today = new Date();
    const endDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const firstChartDay = addUtcDays(endDay, -(CHART_DAYS - 1));
    const activityStartDay = addUtcDays(firstChartDay, -(ACTIVE_STREAK_DAYS - 1));
    const todayKey = isoDay(endDay);
    const chartStartKey = isoDay(firstChartDay);
    const activityStartKey = isoDay(activityStartDay);
    const tomorrow = addUtcDays(endDay, 1);

    const [totalUsers, newUsers, activity] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.aggregate([
        { $match: { role: 'user', createdAt: { $gte: firstChartDay, $lt: tomorrow } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, count: { $sum: 1 } } }
      ]),
      Transaction.aggregate([
        { $match: { transactionDate: { $gte: activityStartKey, $lte: todayKey } } },
        { $group: { _id: { userId: '$userId', date: '$transactionDate' } } }
      ])
    ]);

    const registrationsByDate = new Map(newUsers.map((entry) => [entry._id, entry.count]));
    const usersByActivityDate = new Map();
    for (const entry of activity) {
      const { userId, date } = entry._id;
      if (!usersByActivityDate.has(date)) usersByActivityDate.set(date, new Set());
      usersByActivityDate.get(date).add(String(userId));
    }

    const registrations = [];
    const activeStreak = [];
    for (let offset = 0; offset < CHART_DAYS; offset += 1) {
      const date = addUtcDays(firstChartDay, offset);
      const key = isoDay(date);
      registrations.push({ date: key, count: registrationsByDate.get(key) || 0 });

      let activeCount = 0;
      if (offset >= 0) {
        const endUsers = usersByActivityDate.get(key) || new Set();
        let oldestUsers = endUsers;
        for (let streakOffset = 1; streakOffset < ACTIVE_STREAK_DAYS; streakOffset += 1) {
          const previousKey = isoDay(addUtcDays(date, -streakOffset));
          const previousUsers = usersByActivityDate.get(previousKey) || new Set();
          oldestUsers = new Set([...oldestUsers].filter((userId) => previousUsers.has(userId)));
        }
        activeCount = oldestUsers.size;
      }
      activeStreak.push({ date: key, count: activeCount });
    }

    res.json({
      data: {
        totalUsers,
        period: { startDate: chartStartKey, endDate: todayKey, days: CHART_DAYS },
        activeDefinition: { consecutiveDays: ACTIVE_STREAK_DAYS, description: 'At least one transaction on each consecutive calendar day' },
        registrations,
        activeStreak
      },
      meta: { requestId: req.requestId }
    });
  } catch (error) { next(error); }
});

adminRouter.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25));
    const status = ['active', 'disabled'].includes(req.query.status) ? req.query.status : 'all';
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = { role: 'user', ...(status === 'all' ? {} : { status }) };
    if (query) {
      if (!/^[a-f\d]{1,24}$/i.test(query)) {
        return res.json({ data: [], meta: { requestId: req.requestId, pagination: { page, pageSize, total: 0, pages: 0 } } });
      }
      if (query.length === 24) filter._id = new mongoose.Types.ObjectId(query);
      else filter._id = { $gte: new mongoose.Types.ObjectId(`${query.padEnd(24, '0')}`), $lte: new mongoose.Types.ObjectId(`${query.padEnd(24, 'f')}`) };
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select('_id email status').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean()
    ]);
    res.json({
      data: users.map((user) => ({ id: String(user._id), maskedEmail: maskEmail(user.email), status: user.status })),
      meta: { requestId: req.requestId, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } }
    });
  } catch (error) { next(error); }
});

adminRouter.patch('/users/:id/status', requireCsrf, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'USER_NOT_FOUND' }, meta: { requestId: req.requestId } });
    const parsed = z.object({ status: z.enum(['active', 'disabled']) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR' }, meta: { requestId: req.requestId } });
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'user' },
      { $set: { status: parsed.data.status }, $inc: { sessionVersion: 1 } },
      { new: true, runValidators: true }
    ).select('_id status');
    if (!user) return res.status(404).json({ error: { code: 'USER_NOT_FOUND' }, meta: { requestId: req.requestId } });
    console.info(JSON.stringify({ event: 'admin_user_status_changed', requestId: req.requestId, targetUserId: String(user._id), status: user.status }));
    res.json({ data: { id: String(user._id), status: user.status }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});
