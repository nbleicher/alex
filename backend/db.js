import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let _client = null;
if (supabaseUrl && supabaseKey) {
  _client = createClient(supabaseUrl, supabaseKey);
}

export const supabase = _client;
export function isDbConfigured() {
  return !!_client;
}
