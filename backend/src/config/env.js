import dotenv from 'dotenv';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load workspace-local settings first, then the repository root as a fallback.
// npm workspace scripts run with `backend/` as cwd, while local development
// configuration is commonly kept in the repository root `.env`.
const envPaths = new Set([
  path.resolve(process.cwd(), '.env'),
  fileURLToPath(new URL('../../../.env', import.meta.url))
]);
const serverEnvNames = new Set([
  'NODE_ENV', 'PORT', 'MONGODB_URI', 'APP_ORIGIN', 'JWT_SECRET', 'FRANKFURTER_BASE_URL',
  'AI_CREDENTIALS_ENCRYPTION_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'
]);
for (const envPath of envPaths) {
  try {
    const fileValues = dotenv.parse(readFileSync(envPath));
    for (const [name, value] of Object.entries(fileValues)) {
      // Provider API keys are intentionally excluded; requests use per-user saved credentials.
      if (serverEnvNames.has(name) && process.env[name] === undefined) process.env[name] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/minifinance'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('development-only-change-this-secret'),
  FRANKFURTER_BASE_URL: z.string().url().default('https://api.frankfurter.dev/v2'),
  // This is only the server-side at-rest encryption key. Provider API keys
  // come from each user's saved AI settings and are never read from env vars.
  AI_CREDENTIALS_ENCRYPTION_KEY: z.string().optional().default('').refine((value) => {
    if (!value) return true;
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  }, 'AI_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key'),
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

if (env.NODE_ENV === 'production' && !env.AI_CREDENTIALS_ENCRYPTION_KEY) {
  console.error('AI_CREDENTIALS_ENCRYPTION_KEY must be configured before starting the production server. Generate 32 random bytes and encode them as base64.');
  process.exit(1);
}
