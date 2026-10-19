import { neon, types } from '@neondatabase/serverless';

const NUMERIC_OID = 1700;

// numeric columns come back as JSON numbers, as they did from Supabase
const customTypes = {
  getTypeParser: (id, format) => (id === NUMERIC_OID ? parseFloat : types.getTypeParser(id, format)),
};

let _sql = null;

export function isDbConfigured() {
  return !!process.env.DATABASE_URL;
}

// query('select ... where id = $1', [id]) → rows
export function query(text, params = []) {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  // the HTTP driver reads custom types per query, not from neon() options
  return _sql.query(text, params, { types: customTypes });
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}
