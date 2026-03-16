import { Router } from 'express';
import { supabase } from '../db.js';

export const salesRouter = Router();

// GET /sales
salesRouter.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id,
        product_id,
        product_spec_id,
        quantity_sold,
        sell_price_per_sub,
        revenue,
        created_at,
        client_name,
        products ( name ),
        product_specs ( spec, cat_no )
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = (data || []).map((r) => ({
      ...r,
      product_name: r.products?.name,
      spec: r.product_specs?.spec,
      cat_no: r.product_specs?.cat_no,
    }));
    res.json(list);
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
    const { data, error } = await supabase
      .from('sales')
      .insert({
        product_id,
        product_spec_id,
        quantity_sold: qty,
        sell_price_per_sub: price,
        revenue,
        client_name: client_name || null,
      })
      .select()
      .single();
    if (error) throw error;
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
    const { data: existing, error: fetchError } = await supabase
      .from('sales')
      .select('quantity_sold, sell_price_per_sub')
      .eq('id', req.params.id)
      .single();
    if (fetchError) throw fetchError;
    if (!existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const currentQty = Number(existing.quantity_sold) || 0;
    const currentPrice = Number(existing.sell_price_per_sub) || 0;
    const nextQty = quantity_sold != null ? Math.max(0, parseInt(quantity_sold, 10) || 0) : currentQty;
    const nextPrice = sell_price_per_sub != null ? Number(sell_price_per_sub) || 0 : currentPrice;
    const revenue = nextQty * nextPrice;

    const patch = {
      quantity_sold: nextQty,
      sell_price_per_sub: nextPrice,
      revenue,
    };
    if (client_name !== undefined) {
      patch.client_name = client_name || null;
    }

    const { data, error } = await supabase
      .from('sales')
      .update(patch)
      .eq('id', req.params.id)
      .select(
        `
        id,
        product_id,
        product_spec_id,
        quantity_sold,
        sell_price_per_sub,
        revenue,
        created_at,
        client_name,
        products ( name ),
        product_specs ( spec, cat_no )
        `,
      )
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sales/:id
salesRouter.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('sales').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
