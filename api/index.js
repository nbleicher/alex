// Vercel function: every /api/* request is rewritten here (vercel.json).
import express from 'express';
import { isDbConfigured } from '../backend/db.js';
import { productsRouter } from '../backend/routes/products.js';
import { specsRouter } from '../backend/routes/specs.js';
import { inventoryRouter } from '../backend/routes/inventory.js';
import { salesRouter } from '../backend/routes/sales.js';
import { summaryRouter } from '../backend/routes/summary.js';
import { seedRouter } from '../backend/routes/seed.js';
import { adminAuthRouter } from '../backend/routes/admin-auth.js';
import { ordersRouter } from '../backend/routes/orders.js';
import { requireAdmin } from '../backend/lib/admin-session.js';

const app = express();
const api = express.Router();

app.use(express.json());

api.get('/health', (_, res) => res.json({ ok: true }));

api.use((req, res, next) => {
  if (!isDbConfigured()) {
    return res.status(503).json({
      error: 'Database not configured. Set DATABASE_URL in Vercel project settings.',
    });
  }
  next();
});

api.use('/admin-auth', adminAuthRouter);
api.use('/products', requireAdmin, productsRouter);
api.use('/products', requireAdmin, specsRouter);
api.use('/specs', requireAdmin, specsRouter);
api.use('/inventory', requireAdmin, inventoryRouter);
api.use('/sales', requireAdmin, salesRouter);
api.use('/summary', requireAdmin, summaryRouter);
api.use('/seed', requireAdmin, seedRouter);
api.use('/orders', requireAdmin, ordersRouter);

app.use('/api', api);

app.use((_, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

export default app;
