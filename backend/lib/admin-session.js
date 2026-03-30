import crypto from 'crypto';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function getSecret() {
  return process.env.ADMIN_SESSION_SECRET || '';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signValue(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

export function createAdminSessionToken() {
  const payload = {
    sub: 'admin',
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = base64url(JSON.stringify(payload));
  const sig = signValue(encoded);
  return `${encoded}.${sig}`;
}

export function verifyAdminSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [payloadEncoded, providedSig] = token.split('.');
  if (!payloadEncoded || !providedSig || !getSecret()) return false;
  const expectedSig = signValue(payloadEncoded);
  if (providedSig.length !== expectedSig.length) return false;
  const isSigValid = crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
  if (!isSigValid) return false;
  const parsed = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
  if (!parsed || parsed.sub !== 'admin' || !parsed.exp) return false;
  return Date.now() <= Number(parsed.exp);
}

export function setAdminSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = process.env.ADMIN_COOKIE_SAMESITE || 'Lax';
  const cookieDomain = (process.env.ADMIN_COOKIE_DOMAIN || '').trim();
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (cookieDomain) attrs.push(`Domain=${cookieDomain}`);
  if (isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearAdminSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = process.env.ADMIN_COOKIE_SAMESITE || 'Lax';
  const cookieDomain = (process.env.ADMIN_COOKIE_DOMAIN || '').trim();
  const attrs = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (cookieDomain) attrs.push(`Domain=${cookieDomain}`);
  if (isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function isAdminRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifyAdminSessionToken(cookies[COOKIE_NAME]);
}

export function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  next();
}

