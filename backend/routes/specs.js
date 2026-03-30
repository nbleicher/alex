import { Router } from 'express';
import { supabase } from '../db.js';

export const specsRouter = Router();
const PRODUCT_IMAGES_BUCKET = process.env.PRODUCT_IMAGES_BUCKET || 'product-images';

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
    const { spec, price, cat_no, image_url, available } = req.body;
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
        image_url: image_url ? String(image_url).trim() : null,
        available: !!available,
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
    if (!req.params.id) {
      return res.status(400).json({ error: 'Spec id is required' });
    }
    const { spec, price, cat_no, image_url, available } = req.body;
    const updates = {};
    if (spec !== undefined) updates.spec = String(spec).trim();
    if (price !== undefined) {
      const nextPrice = Number(price);
      if (!Number.isFinite(nextPrice)) {
        return res.status(400).json({ error: 'price must be a number' });
      }
      updates.price = nextPrice;
    }
    if (cat_no !== undefined) {
      const nextCatNo = cat_no == null ? '' : String(cat_no).trim();
      updates.cat_no = nextCatNo || null;
    }
    if (image_url !== undefined) {
      const nextImage = image_url == null ? '' : String(image_url).trim();
      updates.image_url = nextImage || null;
    }
    if (available !== undefined) updates.available = !!available;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const { data, error } = await supabase
      .from('product_specs')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
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

// POST /specs/:id/image
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

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(objectPath, buffer, {
        contentType: contentType || 'image/jpeg',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectPath);
    const imageUrl = pub?.publicUrl || null;

    const { data: updatedSpec, error: updateError } = await supabase
      .from('product_specs')
      .update({ image_url: imageUrl })
      .eq('id', specId)
      .select()
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedSpec) return res.status(404).json({ error: 'Spec not found' });

    res.status(201).json({ image_url: imageUrl, spec: updatedSpec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
