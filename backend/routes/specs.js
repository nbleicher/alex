import { Router } from 'express';
import { supabase } from '../db.js';

export const specsRouter = Router();

// GET /products/:id/specs
specsRouter.get('/:id/specs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('product_specs')
      .select('*')
      .eq('product_id', req.params.id)
      .order('spec');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products/:id/specs
specsRouter.post('/:id/specs', async (req, res) => {
  try {
    const { spec, price, cat_no } = req.body;
    if (!spec || price == null) {
      return res.status(400).json({ error: 'spec and price required' });
    }
    const product_id = req.params.id;
    const { data, error } = await supabase
      .from('product_specs')
      .insert({
        product_id,
        spec: String(spec).trim(),
        price: Number(price),
        cat_no: cat_no != null ? String(cat_no).trim() : null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /specs/:id (mount this router at /specs)
specsRouter.patch('/:id', async (req, res) => {
  try {
    const { spec, price, cat_no } = req.body;
    const updates = {};
    if (spec !== undefined) updates.spec = String(spec).trim();
    if (price !== undefined) updates.price = Number(price);
    if (cat_no !== undefined) updates.cat_no = String(cat_no).trim();
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'At least one of spec, price, cat_no is required' });
    }
    const { data, error } = await supabase
      .from('product_specs')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Spec not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /specs/:id
specsRouter.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('product_specs').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
