import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { env } from '../config/env.js';

export const SESSION_COOKIE = 'mft_session';
export const CSRF_COOKIE = 'mft_csrf';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1',
    maxAge: 30 * 60 * 1000
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1',
    maxAge: 30 * 60 * 1000
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1'
  };
}

export function signSession(user) {
  return jwt.sign({ sv: user.sessionVersion }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: '30m',
    issuer: 'mini-finance-tracker',
    audience: 'mini-finance-tracker-web'
  });
}

export function verifySessionToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: 'mini-finance-tracker',
    audience: 'mini-finance-tracker-web'
  });
}

export async function requireUser(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return unauthorized(res, req);
  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    return unauthorized(res, req);
  }
  try {
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active' || user.sessionVersion !== payload.sv) return unauthorized(res, req);
    // Keep active sessions alive. Both cookies use the same idle lifetime, so
    // renew the CSRF cookie with its existing value when one is present.
    res.cookie(SESSION_COOKIE, signSession(user), sessionCookieOptions());
    const csrfToken = req.cookies?.[CSRF_COOKIE];
    if (csrfToken) res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function optionalUser(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  jwt.verify(token, env.JWT_SECRET, { issuer: 'mini-finance-tracker', audience: 'mini-finance-tracker-web' }, (error, payload) => {
    if (!error) req.authPayload = payload;
    next();
  });
}

function unauthorized(res, req) {
  return res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue' },
    meta: { requestId: req.requestId }
  });
}
