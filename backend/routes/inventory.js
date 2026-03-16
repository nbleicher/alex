import { Router } from 'express';
import { supabase } from '../db.js';

export const inventoryRouter = Router();

// GET /inventory – list all inventory rows with product + spec + price for display
inventoryRouter.get('/', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('inventory')
      .select('id, product_id, product_spec_id, quantity, created_at');
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
      const price = spec.price ? Number(spec.price) : 0;
      return {
        id: r.id,
        product_id: r.product_id,
        product_spec_id: r.product_spec_id,
        quantity: r.quantity,
        created_at: r.created_at,
        product_name: product.name,
        spec: spec.spec,
        price,
        cat_no: spec.cat_no,
        total: price * (r.quantity || 0),
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
