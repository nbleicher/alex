// One-time copy of all data from Supabase to Neon: npm run migrate:supabase
// Re-runnable: empties the Neon tables first, so run it once more right before cutover.
// Spec/product images in Supabase Storage are copied to Vercel Blob and their URLs rewritten.
import { put } from '@vercel/blob';
import { query } from '../db.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAGE_SIZE = 1000;
const INSERT_BATCH = 500;

// Parents before children so foreign keys hold.
const TABLES = {
  products: ['id', 'name', 'image_url', 'created_at', 'updated_at'],
  product_specs: ['id', 'product_id', 'spec', 'price', 'cat_no', 'image_url', 'available', 'created_at'],
  inventory: [
    'id', 'product_id', 'product_spec_id', 'quantity', 'unit_cost', 'status', 'purchase_date', 'created_at', 'updated_at',
  ],
  sales: [
    'id', 'product_id', 'product_spec_id', 'quantity_sold', 'sell_price_per_sub', 'revenue', 'created_at', 'client_name',
  ],
  summary_overrides: [
    'id', 'manual_total_spend', 'manual_total_revenue', 'spend_adjustment', 'reason', 'effective_from', 'created_at',
  ],
  orders: ['id', 'order_number', 'first_name', 'last_name', 'phone', 'referral', 'status', 'created_at', 'updated_at'],
  order_items: [
    'id', 'order_id', 'product_id', 'product_spec_id', 'product_name_snapshot', 'spec_snapshot', 'ordered_quantity',
    'reserved_quantity', 'unit_price', 'created_at',
  ],
  order_item_reservations: ['id', 'order_item_id', 'inventory_id', 'quantity', 'created_at'],
};

for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BLOB_READ_WRITE_TOKEN']) {
  if (!process.env[name]) {
    console.error(`Set ${name} (e.g. in .env.local)`);
    process.exit(1);
  }
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path> → Blob URL at <path>
const copiedImages = new Map();
async function copyImage(url) {
  if (!url || !url.includes('.supabase.co/storage/')) return url;
  if (copiedImages.has(url)) return copiedImages.get(url);
  const match = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
  if (!match) throw new Error(`Unrecognized Supabase image URL: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  image ${res.status}, keeping old URL: ${url}`);
    copiedImages.set(url, url);
    return url;
  }
  const blob = await put(decodeURIComponent(match[1]), Buffer.from(await res.arrayBuffer()), {
    access: 'public',
    contentType: res.headers.get('content-type') || 'image/jpeg',
    allowOverwrite: true,
  });
  copiedImages.set(url, blob.url);
  return blob.url;
}

async function insertRows(table, columns, rows) {
  const cols = columns.join(', ');
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
    await query(
      `insert into ${table} (${cols}) select ${cols} from json_populate_recordset(null::${table}, $1::json)`,
      [JSON.stringify(batch)],
    );
  }
}

async function migrate() {
  await query(`truncate ${Object.keys(TABLES).join(', ')} cascade`);

  for (const [table, columns] of Object.entries(TABLES)) {
    const rows = await fetchAll(table);
    if (columns.includes('image_url')) {
      for (const row of rows) row.image_url = await copyImage(row.image_url);
    }
    await insertRows(table, columns, rows);
    const [{ count }] = await query(`select count(*)::int as count from ${table}`);
    console.log(`${table}: ${rows.length} read, ${count} in Neon`);
  }
  console.log(`images copied to Blob: ${[...copiedImages].filter(([from, to]) => from !== to).length}`);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
