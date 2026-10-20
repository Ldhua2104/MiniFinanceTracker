import { timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE } from './auth.js';
import { env } from '../config/env.js';

export function requireCsrf(req, res, next) {
  const origin = req.get('origin');
  const configuredOrigin = new URL(env.APP_ORIGIN).origin;
  const sameOrigin = req.get('host') ? `${req.protocol}://${req.get('host')}` : null;
  if (origin && origin !== configuredOrigin && origin !== sameOrigin) {
    return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed' }, meta: { requestId: req.requestId } });
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: { code: 'CSRF_REQUIRED', message: 'Refresh the page and try again' }, meta: { requestId: req.requestId } });
  }
  const expected = Buffer.from(cookieToken);
  const supplied = Buffer.from(headerToken);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Refresh the page and try again' }, meta: { requestId: req.requestId } });
  }
  next();
}
