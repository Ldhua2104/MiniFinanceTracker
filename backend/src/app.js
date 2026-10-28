import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.get('/api/v1/health', (_req, res) => {
  res.json({ data: { status: 'ok' }, meta: { requestId: _req.requestId } });
});

app.get('/api/v1/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    data: { status: ready ? 'ready' : 'not_ready', database: ready ? 'connected' : 'disconnected' },
    meta: { requestId: _req.requestId }
  });
});

app.get('/api/v1', (_req, res) => {
  res.json({ data: { name: 'Mini Finance Tracker API', version: 'v1' }, meta: { requestId: _req.requestId } });
});

app.use('/api/v1/auth', authRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' }, meta: { requestId: _req.requestId } });
});

const frontendDist = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
app.use(express.static(frontendDist, { index: false, fallthrough: true }));
app.get(/.*/, (req, res, next) => {
  const indexPath = path.join(frontendDist, 'index.html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(indexPath, { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }, (error) => {
    if (error) next();
  });
});

app.use((error, req, res, _next) => {
  console.error({ requestId: req.requestId, message: error.message });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    meta: { requestId: req.requestId }
  });
});

export const appOrigin = env.APP_ORIGIN;
