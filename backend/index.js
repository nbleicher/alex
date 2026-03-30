import express from 'express';
import cors from 'cors';
import { supabase, isDbConfigured } from './db.js';
import { productsRouter } from './routes/products.js';
import { specsRouter } from './routes/specs.js';
import { inventoryRouter } from './routes/inventory.js';
import { salesRouter } from './routes/sales.js';
import { summaryRouter } from './routes/summary.js';
import { seedRouter } from './routes/seed.js';
import { adminAuthRouter } from './routes/admin-auth.js';
import { ordersRouter } from './routes/orders.js';
import { requireAdmin } from './lib/admin-session.js';

const app = express();
const PORT = process.env.PORT || 3000;
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000';
const origins = corsOrigin.split(',').map(s => s.trim());

app.use(cors({ origin: origins }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (!isDbConfigured()) {
    return res.status(503).json({
      error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Railway variables.',
    });
  }
  next();
});

app.use('/products', productsRouter);
app.use('/admin-auth', adminAuthRouter);
app.use('/products', requireAdmin, specsRouter);
app.use('/specs', requireAdmin, specsRouter);
app.use('/inventory', requireAdmin, inventoryRouter);
app.use('/sales', requireAdmin, salesRouter);
app.use('/summary', requireAdmin, summaryRouter);
app.use('/seed', requireAdmin, seedRouter);
app.use('/orders', (req, res, next) => {
  if (req.method === 'POST') return next();
  return requireAdmin(req, res, next);
}, ordersRouter);

app.use((_, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${PORT}`);
});
