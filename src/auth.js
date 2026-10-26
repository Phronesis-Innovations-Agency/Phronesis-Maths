// Small signed-token auth (HMAC-SHA256). No external auth service needed.
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'dev-only-secret-change-me';
if (!process.env.APP_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: APP_SECRET is not set. Set it in Render before real users join.');
}

const DAY = 24 * 60 * 60 * 1000;
const TTL = { learner: 180 * DAY, teacher: 30 * DAY, admin: 1 * DAY };

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TTL[payload.role] }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Express middleware: require a token with the given role.
function requireRole(role) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verify(token);
    if (!payload || payload.role !== role) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    req.user = payload;
    next();
  };
}

// Simple in-memory lockout to slow down PIN / password guessing.
const failures = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 10 * 60 * 1000;

function isLocked(key) {
  const f = failures.get(key);
  return !!(f && f.count >= LOCK_AFTER && Date.now() - f.last < LOCK_MS);
}
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, last: 0 };
  if (Date.now() - f.last > LOCK_MS) f.count = 0;
  f.count += 1;
  f.last = Date.now();
  failures.set(key, f);
}
function clearFailures(key) {
  failures.delete(key);
}

module.exports = { sign, verify, requireRole, isLocked, recordFailure, clearFailures };
