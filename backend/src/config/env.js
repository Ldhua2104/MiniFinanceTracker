import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/minifinance'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('development-only-change-this-secret'),
  FRANKFURTER_BASE_URL: z.string().url().default('https://api.frankfurter.dev/v2'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_API_KEY: z.string().optional().default(''),
  DEEPSEEK_MODEL: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default(''),
  ADMIN_EMAIL: z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional()),
  ADMIN_PASSWORD: z.preprocess((value) => value === '' ? undefined : value, z.string().min(12).optional())
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'development-only-change-this-secret') {
  console.error('JWT_SECRET must be configured with a production secret before starting the server.');
  process.exit(1);
}
