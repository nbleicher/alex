import { Router } from 'express';
import {
  clearAdminSessionCookie,
  createAdminSessionToken,
  isAdminRequest,
  setAdminSessionCookie,
} from '../lib/admin-session.js';

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUsername = process.env.ADMIN_USERNAME || '';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!expectedUsername || !expectedPassword) {
    return res.status(503).json({ error: 'Admin credentials are not configured on server' });
  }
  if (username !== expectedUsername || password !== expectedPassword) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createAdminSessionToken();
  setAdminSessionCookie(res, token);
  res.json({ ok: true });
});

adminAuthRouter.post('/logout', (_req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

adminAuthRouter.get('/me', (req, res) => {
  res.json({ authenticated: isAdminRequest(req) });
});

