import { Router } from 'express';
import { query, queryOne } from '../db.js';
import { recomputeOpenOrderReservations } from './orders.js';

export const inventoryRouter = Router();
const ALLOWED_STATUSES = new Set(['Delivered', 'Shipped', 'Processing', 'Scammed']);
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

// '' / null clears the status; anything else must be an allowed status
function parseStatus(status) {
  if (status == null || String(status).trim() === '') return { value: null };
  const normalizedStatus = String(status).trim();
  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    return { error: 'status must be one of Delivered, Shipped, Processing, Scammed' };
  }
  return { value: normalizedStatus };
}

// GET /inventory – list all inventory rows with product + spec + price for display
inventoryRouter.get('/', async (req, res) => {
  try {
    const rows = await query(`
      select i.id, i.product_id, i.product_spec_id, i.quantity, i.unit_cost, i.status, i.purchase_date,
             i.created_at, p.name as product_name, ps.spec, ps.price as spec_price, ps.cat_no
      from inventory i
      left join products p on p.id = i.product_id
      left join product_specs ps on ps.id = i.product_spec_id`);

    const list = rows.map((r) => {
      const catalogPrice = toNumber(r.spec_price);
      const price = r.unit_cost != null && r.unit_cost !== '' ? toNumber(r.unit_cost) : catalogPrice;
      return {
        id: r.id,
        product_id: r.product_id,
        product_spec_id: r.product_spec_id,
        quantity: r.quantity,
        unit_cost: r.unit_cost != null ? toNumber(r.unit_cost) : null,
        catalog_price: catalogPrice,
        status: r.status || null,
        purchase_date: r.purchase_date,
        created_at: r.created_at,
        product_name: r.product_name,
        spec: r.spec,
        price,
        cat_no: r.cat_no,
        total: price * toNumber(r.quantity),
      };
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /inventory – update by id, or insert new purchase line when id omitted
inventoryRouter.put('/', async (req, res) => {
  try {
    const { id, product_id, product_spec_id, quantity, purchase_date, status, unit_cost } = req.body;

    if (id) {
      const sets = ['updated_at = now()'];
      const params = [id];
      const set = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (quantity !== undefined) {
        set('quantity', Math.max(0, parseInt(quantity, 10) || 0));
      }
      if (purchase_date !== undefined) {
        if (purchase_date == null || String(purchase_date).trim() === '') {
          set('purchase_date', null);
        } else {
          const d = new Date(purchase_date);
          if (!Number.isNaN(d.getTime())) {
            set('purchase_date', d.toISOString());
          }
        }
      }
      if (status !== undefined) {
        const parsed = parseStatus(status);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        set('status', parsed.value);
      }
      if (unit_cost !== undefined) {
        set('unit_cost', unit_cost == null || String(unit_cost).trim() === '' ? null : toNumber(unit_cost));
      }
      const data = await queryOne(`update inventory set ${sets.join(', ')} where id = $1 returning *`, params);
      if (!data) return res.status(404).json({ error: 'Inventory row not found' });
      await recomputeOpenOrderReservations();
      return res.json(data);
    }

    if (!product_id || !product_spec_id || quantity == null) {
      return res.status(400).json({ error: 'product_id, product_spec_id, quantity required' });
    }
    const qty = Math.max(0, parseInt(quantity, 10) || 0);
    if (qty === 0) {
      return res.status(400).json({ error: 'quantity must be greater than 0 for a new purchase' });
    }

    let resolvedCost;
    if (unit_cost !== undefined && unit_cost !== null && String(unit_cost).trim() !== '') {
      resolvedCost = toNumber(unit_cost);
    } else {
      const specRow = await queryOne('select price from product_specs where id = $1', [product_spec_id]);
      resolvedCost = toNumber(specRow?.price);
    }

    // New purchases should default to sellable stock unless explicitly set otherwise.
    let rowStatus = 'Delivered';
    if (status !== undefined) {
      const parsed = parseStatus(status);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      rowStatus = parsed.value;
    }
    let rowPurchaseDate = null;
    if (purchase_date) {
      const d = new Date(purchase_date);
      if (!Number.isNaN(d.getTime())) {
        rowPurchaseDate = d.toISOString();
      }
    }

    const data = await queryOne(
      `insert into inventory (product_id, product_spec_id, quantity, unit_cost, status, purchase_date, updated_at)
       values ($1, $2, $3, $4, $5, $6, now()) returning *`,
      [product_id, product_spec_id, qty, resolvedCost, rowStatus, rowPurchaseDate],
    );
    await recomputeOpenOrderReservations();
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
