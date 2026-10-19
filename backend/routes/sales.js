import { Router } from 'express';
import { query, queryOne } from '../db.js';

export const salesRouter = Router();

const SALE_WITH_NAMES = `
  select s.id, s.product_id, s.product_spec_id, s.quantity_sold, s.sell_price_per_sub, s.revenue,
         s.created_at, s.client_name, p.name as product_name, ps.spec, ps.cat_no
  from sales s
  left join products p on p.id = s.product_id
  left join product_specs ps on ps.id = s.product_spec_id`;

// GET /sales
salesRouter.get('/', async (req, res) => {
  try {
    res.json(await query(`${SALE_WITH_NAMES} order by s.created_at desc`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sales
salesRouter.post('/', async (req, res) => {
  try {
    const { product_id, product_spec_id, quantity_sold, sell_price_per_sub, client_name } = req.body;
    if (!product_id || !product_spec_id || quantity_sold == null || sell_price_per_sub == null) {
      return res.status(400).json({
        error: 'product_id, product_spec_id, quantity_sold, sell_price_per_sub required',
      });
    }
    const qty = Math.max(0, parseInt(quantity_sold, 10) || 0);
    const price = Number(sell_price_per_sub) || 0;
    const revenue = qty * price;
    const data = await queryOne(
      `insert into sales (product_id, product_spec_id, quantity_sold, sell_price_per_sub, revenue, client_name)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [product_id, product_spec_id, qty, price, revenue, client_name || null],
    );
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sales/:id – edit sale (qty, price, client_name) and recompute revenue
salesRouter.patch('/:id', async (req, res) => {
  try {
    const { quantity_sold, sell_price_per_sub, client_name } = req.body || {};
    if (quantity_sold == null && sell_price_per_sub == null && client_name == null) {
      return res.status(400).json({ error: 'At least one of quantity_sold, sell_price_per_sub, client_name is required' });
    }

    // Fetch existing sale to base calculations on
    const existing = await queryOne('select quantity_sold, sell_price_per_sub, client_name from sales where id = $1', [
      req.params.id,
    ]);
    if (!existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const currentQty = Number(existing.quantity_sold) || 0;
    const currentPrice = Number(existing.sell_price_per_sub) || 0;
    const nextQty = quantity_sold != null ? Math.max(0, parseInt(quantity_sold, 10) || 0) : currentQty;
    const nextPrice = sell_price_per_sub != null ? Number(sell_price_per_sub) || 0 : currentPrice;
    const revenue = nextQty * nextPrice;
    const nextClient = client_name !== undefined ? client_name || null : existing.client_name;

    await query(
      'update sales set quantity_sold = $2, sell_price_per_sub = $3, revenue = $4, client_name = $5 where id = $1',
      [req.params.id, nextQty, nextPrice, revenue, nextClient],
    );
    res.json(await queryOne(`${SALE_WITH_NAMES} where s.id = $1`, [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sales/:id
salesRouter.delete('/:id', async (req, res) => {
  try {
    await query('delete from sales where id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
