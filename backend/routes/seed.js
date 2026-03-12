import { Router } from 'express';
import { supabase } from '../db.js';
import { seedData } from '../data/seed-data.js';

export const seedRouter = Router();

// POST /seed – one-time seed (idempotent: upsert by product name + spec)
seedRouter.post('/', async (req, res) => {
  try {
    let created = 0;
    let specsCreated = 0;
    for (const item of seedData) {
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('name', item.productName)
        .maybeSingle();
      let productId = existing?.id;
      if (!productId) {
        const { data: inserted, error } = await supabase
          .from('products')
          .insert({ name: item.productName })
          .select('id')
          .single();
        if (error) throw error;
        productId = inserted.id;
        created++;
      }
      for (const spec of item.specs) {
        const { data: specExists } = await supabase
          .from('product_specs')
          .select('id')
          .eq('product_id', productId)
          .eq('spec', spec.spec)
          .maybeSingle();
        if (!specExists) {
          const { error } = await supabase.from('product_specs').insert({
            product_id: productId,
            spec: spec.spec,
            price: spec.price,
            cat_no: spec.catNo || null,
          });
          if (error) throw error;
          specsCreated++;
        }
      }
    }
    res.json({ message: 'Seed complete', productsCreated: created, specsCreated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
