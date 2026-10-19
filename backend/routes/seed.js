import { Router } from 'express';
import { queryOne } from '../db.js';
import { seedData } from '../data/seed-data.js';

export const seedRouter = Router();

// POST /seed – one-time seed (idempotent: upsert by product name + spec)
seedRouter.post('/', async (req, res) => {
  try {
    let created = 0;
    let specsCreated = 0;
    for (const item of seedData) {
      const existing = await queryOne('select id from products where name = $1 limit 1', [item.productName]);
      let productId = existing?.id;
      if (!productId) {
        const inserted = await queryOne('insert into products (name) values ($1) returning id', [item.productName]);
        productId = inserted.id;
        created++;
      }
      for (const spec of item.specs) {
        const specExists = await queryOne('select id from product_specs where product_id = $1 and spec = $2', [
          productId,
          spec.spec,
        ]);
        if (!specExists) {
          await queryOne('insert into product_specs (product_id, spec, price, cat_no) values ($1, $2, $3, $4)', [
            productId,
            spec.spec,
            spec.price,
            spec.catNo || null,
          ]);
          specsCreated++;
        }
      }
    }
    res.json({ message: 'Seed complete', productsCreated: created, specsCreated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
