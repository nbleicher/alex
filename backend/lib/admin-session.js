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

// mustChangePassword sessions may only change the password (see requireAdmin)
export function createAdminSessionToken({ username, mustChangePassword }) {
  const payload = {
    sub: 'admin',
    user: username,
    mustChangePassword: !!mustChangePassword,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = base64url(JSON.stringify(payload));
  const sig = signValue(encoded);
  return `${encoded}.${sig}`;
}

// → session payload, or null when missing/invalid/expired
export function verifyAdminSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payloadEncoded, providedSig] = token.split('.');
  if (!payloadEncoded || !providedSig || !getSecret()) return null;
  const expectedSig = signValue(payloadEncoded);
  if (providedSig.length !== expectedSig.length) return null;
  const isSigValid = crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
  if (!isSigValid) return null;
  const parsed = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
  if (!parsed || parsed.sub !== 'admin' || !parsed.user || !parsed.exp) return null;
  return Date.now() <= Number(parsed.exp) ? parsed : null;
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

export function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifyAdminSessionToken(cookies[COOKIE_NAME]);
}

export function requireAdmin(req, res, next) {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  if (session.mustChangePassword) {
    return res.status(403).json({ error: 'Set a new password first', mustChangePassword: true });
  }
  next();
}

