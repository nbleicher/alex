import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  clearAdminSessionCookie,
  createAdminSessionToken,
  getAdminSession,
  setAdminSessionCookie,
} from '../lib/admin-session.js';

export const adminAuthRouter = Router();

const MIN_PASSWORD_LENGTH = 8;

adminAuthRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await queryOne('select * from admin_users where username = $1', [String(username || '').trim()]);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = createAdminSessionToken({
      username: user.username,
      mustChangePassword: user.must_change_password,
    });
    setAdminSessionCookie(res, token);
    res.json({ ok: true, mustChangePassword: user.must_change_password });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Works for must-change sessions too; that is how the first-login reset completes.
adminAuthRouter.post('/change-password', async (req, res) => {
  try {
    const session = getAdminSession(req);
    if (!session) return res.status(401).json({ error: 'Admin login required' });

    const { currentPassword, newPassword } = req.body || {};
    const user = await queryOne('select * from admin_users where username = $1', [session.user]);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    await query(
      'update admin_users set password_hash = $2, must_change_password = false, updated_at = now() where username = $1',
      [user.username, await hashPassword(newPassword)],
    );
    setAdminSessionCookie(res, createAdminSessionToken({ username: user.username, mustChangePassword: false }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminAuthRouter.post('/logout', (_req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

adminAuthRouter.get('/me', (req, res) => {
  const session = getAdminSession(req);
  res.json({
    authenticated: !!session && !session.mustChangePassword,
    mustChangePassword: !!session?.mustChangePassword,
  });
});
