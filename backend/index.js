import express from 'express';
import cors from 'cors';
import { productsRouter } from './routes/products.js';
import { specsRouter } from './routes/specs.js';
import { inventoryRouter } from './routes/inventory.js';
import { salesRouter } from './routes/sales.js';
import { summaryRouter } from './routes/summary.js';
import { seedRouter } from './routes/seed.js';

const app = express();
const PORT = process.env.PORT || 3000;
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000';
const origins = corsOrigin.split(',').map(s => s.trim());

app.use(cors({ origin: origins }));
app.use(express.json());

// Mount specs under /products first so /products/:id/specs takes precedence
app.use('/products', specsRouter);
app.use('/products', productsRouter);
app.use('/specs', specsRouter);
app.use('/inventory', inventoryRouter);
app.use('/sales', salesRouter);
app.use('/summary', summaryRouter);
app.use('/seed', seedRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
