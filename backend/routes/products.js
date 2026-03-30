import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAdmin } from '../lib/admin-session.js';

export const productsRouter = Router();

productsRouter.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/public') return next();
  return requireAdmin(req, res, next);
});

productsRouter.get('/public', async (_req, res) => {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('available', true)
      .order('name');
    if (productsError) throw productsError;

    if (!products || products.length === 0) return res.json([]);
    const productIds = products.map((p) => p.id);
    const { data: specs, error: specsError } = await supabase
      .from('product_specs')
      .select('*')
      .in('product_id', productIds)
      .order('spec');
    if (specsError) throw specsError;

    const byProduct = {};
    for (const p of products) byProduct[p.id] = { ...p, specs: [] };
    for (const s of specs || []) {
      if (byProduct[s.product_id]) byProduct[s.product_id].specs.push(s);
    }
    res.json(Object.values(byProduct));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /products – list all with specs
productsRouter.get('/', async (req, res) => {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .order('name');
    if (productsError) throw productsError;

    const { data: specs, error: specsError } = await supabase
      .from('product_specs')
      .select('*')
      .order('spec');
    if (specsError) throw specsError;

    const byProduct = {};
    for (const p of products) {
      byProduct[p.id] = { ...p, specs: [] };
    }
    for (const s of specs) {
      if (byProduct[s.product_id]) byProduct[s.product_id].specs.push(s);
    }
    res.json(Object.values(byProduct));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /products/:id
productsRouter.get('/:id', async (req, res) => {
  try {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const { data: specs } = await supabase
      .from('product_specs')
      .select('*')
      .eq('product_id', req.params.id)
      .order('spec');
    res.json({ ...product, specs: specs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products
productsRouter.post('/', async (req, res) => {
  try {
    const { name, available, image_url } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name required' });
    }
    const { data, error } = await supabase
      .from('products')
      .insert({
        name: name.trim(),
        available: !!available,
        image_url: image_url ? String(image_url).trim() : null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ ...data, specs: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /products/:id
productsRouter.patch('/:id', async (req, res) => {
  try {
    const { name, available, image_url } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) {
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.name = name.trim();
    }
    if (available !== undefined) updates.available = !!available;
    if (image_url !== undefined) updates.image_url = image_url ? String(image_url).trim() : null;
    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found' });
    const { data: specs } = await supabase
      .from('product_specs')
      .select('*')
      .eq('product_id', req.params.id)
      .order('spec');
    res.json({ ...data, specs: specs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /products/:id
productsRouter.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
