import { Router } from 'express';
import { query, queryOne } from '../db.js';

export const productsRouter = Router();

async function withSpecs(product) {
  const specs = await query('select * from product_specs where product_id = $1 order by spec', [product.id]);
  return { ...product, specs };
}

// GET /products – list all with specs
productsRouter.get('/', async (req, res) => {
  try {
    const products = await query('select * from products order by name');
    const specs = await query('select * from product_specs order by spec');

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
    const product = await queryOne('select * from products where id = $1', [req.params.id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(await withSpecs(product));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products
productsRouter.post('/', async (req, res) => {
  try {
    const { name, image_url } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name required' });
    }
    const data = await queryOne(
      'insert into products (name, image_url) values ($1, $2) returning *',
      [name.trim(), image_url ? String(image_url).trim() : null],
    );
    res.status(201).json({ ...data, specs: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /products/:id
productsRouter.patch('/:id', async (req, res) => {
  try {
    const { name, image_url } = req.body || {};
    const sets = ['updated_at = now()'];
    const params = [req.params.id];
    if (name !== undefined) {
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      params.push(name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (image_url !== undefined) {
      params.push(image_url ? String(image_url).trim() : null);
      sets.push(`image_url = $${params.length}`);
    }
    if (sets.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const data = await queryOne(`update products set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json(await withSpecs(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /products/:id
productsRouter.delete('/:id', async (req, res) => {
  try {
    await query('delete from products where id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
