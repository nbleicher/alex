import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { seedData } from '../data/seed-data.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (e.g. in backend/.env)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  let created = 0;
  let specsCreated = 0;
  for (const item of seedData) {
    const { data: existing } = await supabase.from('products').select('id').eq('name', item.productName).maybeSingle();
    let productId = existing?.id;
    if (!productId) {
      const { data: inserted, error } = await supabase.from('products').insert({ name: item.productName }).select('id').single();
      if (error) {
        console.error('Insert product', item.productName, error);
        throw error;
      }
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
        if (error) {
          console.error('Insert spec', spec.spec, error);
          throw error;
        }
        specsCreated++;
      }
    }
  }
  console.log('Seed complete. Products created:', created, 'Specs created:', specsCreated);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
