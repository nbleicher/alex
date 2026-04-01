import { Router } from 'express';
import { supabase } from '../db.js';
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

// GET /inventory – list all inventory rows with product + spec + price for display
inventoryRouter.get('/', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('inventory')
      .select('id, product_id, product_spec_id, quantity, unit_cost, status, purchase_date, created_at');
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.json([]);
    }

    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const specIds = [...new Set(rows.map((r) => r.product_spec_id))];

    const { data: products } = await supabase
      .from('products')
      .select('id, name')
      .in('id', productIds);
    const { data: specs } = await supabase
      .from('product_specs')
      .select('id, product_id, spec, price, cat_no')
      .in('id', specIds);

    const productsBy = (products || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
    const specsBy = (specs || []).reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

    const list = rows.map((r) => {
      const product = productsBy[r.product_id] || {};
      const spec = specsBy[r.product_spec_id] || {};
      const catalogPrice = toNumber(spec.price);
      const price =
        r.unit_cost != null && r.unit_cost !== '' ? toNumber(r.unit_cost) : catalogPrice;
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
        product_name: product.name,
        spec: spec.spec,
        price,
        cat_no: spec.cat_no,
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
    const {
      id,
      product_id,
      product_spec_id,
      quantity,
      purchase_date,
      status,
      unit_cost,
    } = req.body;

    if (id) {
      const updates = { updated_at: new Date().toISOString() };
      if (quantity !== undefined) {
        updates.quantity = Math.max(0, parseInt(quantity, 10) || 0);
      }
      if (purchase_date !== undefined) {
        if (purchase_date == null || String(purchase_date).trim() === '') {
          updates.purchase_date = null;
        } else {
          const d = new Date(purchase_date);
          if (!Number.isNaN(d.getTime())) {
            updates.purchase_date = d.toISOString();
          }
        }
      }
      if (status !== undefined) {
        if (status == null || String(status).trim() === '') {
          updates.status = null;
        } else {
          const normalizedStatus = String(status).trim();
          if (!ALLOWED_STATUSES.has(normalizedStatus)) {
            return res.status(400).json({
              error: 'status must be one of Delivered, Shipped, Processing, Scammed',
            });
          }
          updates.status = normalizedStatus;
        }
      }
      if (unit_cost !== undefined) {
        if (unit_cost == null || String(unit_cost).trim() === '') {
          updates.unit_cost = null;
        } else {
          updates.unit_cost = toNumber(unit_cost);
        }
      }
      const { data, error } = await supabase
        .from('inventory')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) throw error;
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
      const { data: specRow, error: specErr } = await supabase
        .from('product_specs')
        .select('price')
        .eq('id', product_spec_id)
        .maybeSingle();
      if (specErr) throw specErr;
      resolvedCost = toNumber(specRow?.price);
    }

    const row = {
      product_id,
      product_spec_id,
      quantity: qty,
      unit_cost: resolvedCost,
      updated_at: new Date().toISOString(),
    };
    if (status !== undefined) {
      if (status == null || String(status).trim() === '') {
        row.status = null;
      } else {
        const normalizedStatus = String(status).trim();
        if (!ALLOWED_STATUSES.has(normalizedStatus)) {
          return res.status(400).json({
            error: 'status must be one of Delivered, Shipped, Processing, Scammed',
          });
        }
        row.status = normalizedStatus;
      }
    } else {
      // New purchases should default to sellable stock unless explicitly set otherwise.
      row.status = 'Delivered';
    }
    if (purchase_date) {
      const d = new Date(purchase_date);
      if (!Number.isNaN(d.getTime())) {
        row.purchase_date = d.toISOString();
      }
    }

    const { data, error } = await supabase.from('inventory').insert(row).select().single();
    if (error) throw error;
    await recomputeOpenOrderReservations();
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
