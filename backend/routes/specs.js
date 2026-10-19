import { Router } from 'express';
import { put } from '@vercel/blob';
import { query, queryOne } from '../db.js';

export const specsRouter = Router();

// GET /products/:id/specs
specsRouter.get('/:id/specs', async (req, res) => {
  try {
    res.json(await query('select * from product_specs where product_id = $1 order by spec', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /products/:id/specs
specsRouter.post('/:id/specs', async (req, res) => {
  try {
    const { spec, price, cat_no, image_url, available } = req.body;
    if (!spec || price == null) {
      return res.status(400).json({ error: 'spec and price required' });
    }
    const data = await queryOne(
      `insert into product_specs (product_id, spec, price, cat_no, image_url, available)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        req.params.id,
        String(spec).trim(),
        Number(price),
        cat_no != null ? String(cat_no).trim() : null,
        image_url ? String(image_url).trim() : null,
        !!available,
      ],
    );
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /specs/:id (mount this router at /specs)
specsRouter.patch('/:id', async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ error: 'Spec id is required' });
    }
    const { spec, price, cat_no, image_url, available } = req.body;
    const sets = [];
    const params = [req.params.id];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (spec !== undefined) set('spec', String(spec).trim());
    if (price !== undefined) {
      const nextPrice = Number(price);
      if (!Number.isFinite(nextPrice)) {
        return res.status(400).json({ error: 'price must be a number' });
      }
      set('price', nextPrice);
    }
    if (cat_no !== undefined) {
      const nextCatNo = cat_no == null ? '' : String(cat_no).trim();
      set('cat_no', nextCatNo || null);
    }
    if (image_url !== undefined) {
      const nextImage = image_url == null ? '' : String(image_url).trim();
      set('image_url', nextImage || null);
    }
    if (available !== undefined) set('available', !!available);
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const data = await queryOne(`update product_specs set ${sets.join(', ')} where id = $1 returning *`, params);
    if (!data) return res.status(404).json({ error: 'Spec not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /specs/:id
specsRouter.delete('/:id', async (req, res) => {
  try {
    await query('delete from product_specs where id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /specs/:id/image – upload to Vercel Blob and store its public URL on the spec
specsRouter.post('/:id/image', async (req, res) => {
  try {
    const specId = req.params.id;
    const { filename, contentType, dataBase64 } = req.body || {};
    if (!specId || !dataBase64) {
      return res.status(400).json({ error: 'spec id and dataBase64 are required' });
    }

    const safeName = (filename || 'image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = safeName.includes('.') ? safeName.split('.').pop() : 'jpg';
    const objectPath = `specs/${specId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(String(dataBase64), 'base64');

    const blob = await put(objectPath, buffer, {
      access: 'public',
      contentType: contentType || 'image/jpeg',
      allowOverwrite: true,
    });
    const imageUrl = blob.url;

    const updatedSpec = await queryOne('update product_specs set image_url = $2 where id = $1 returning *', [
      specId,
      imageUrl,
    ]);
    if (!updatedSpec) return res.status(404).json({ error: 'Spec not found' });

    res.status(201).json({ image_url: imageUrl, spec: updatedSpec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
