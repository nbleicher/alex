import { Router } from 'express';
import { supabase } from '../db.js';

export const inventoryRouter = Router();

// GET /inventory – list all inventory rows with product + spec + price for display
inventoryRouter.get('/', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('inventory')
      .select(`
        id,
        product_id,
        product_spec_id,
        quantity,
        products ( id, name ),
        product_specs ( id, spec, price, cat_no )
      `);
    if (error) throw error;

    const list = (rows || []).map((r) => {
      const product = r.products || {};
      const spec = r.product_specs || {};
      return {
        id: r.id,
        product_id: r.product_id,
        product_spec_id: r.product_spec_id,
        quantity: r.quantity,
        product_name: product.name,
        spec: spec.spec,
        price: spec.price ? Number(spec.price) : 0,
        cat_no: spec.cat_no,
        total: (Number(spec.price) || 0) * (r.quantity || 0),
      };
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /inventory – upsert: body = { product_id, product_spec_id, quantity }
inventoryRouter.put('/', async (req, res) => {
  try {
    const { product_id, product_spec_id, quantity } = req.body;
    if (!product_id || !product_spec_id || quantity == null) {
      return res.status(400).json({ error: 'product_id, product_spec_id, quantity required' });
    }
    const qty = Math.max(0, parseInt(quantity, 10) || 0);

    const { data: existing } = await supabase
      .from('inventory')
      .select('id')
      .eq('product_id', product_id)
      .single();

    const row = {
      product_id,
      product_spec_id,
      quantity: qty,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await supabase
        .from('inventory')
        .update(row)
        .eq('product_id', product_id)
        .select()
        .single();
      if (error) throw error;
      return res.json(data);
    }
    const { data, error } = await supabase.from('inventory').insert(row).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
