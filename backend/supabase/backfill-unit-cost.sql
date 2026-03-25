-- Optional: fix Spend lines that still follow live catalog (unit_cost IS NULL).
-- Run in Supabase SQL Editor when you are ready.

-- 1) Verification — rows that still use catalog fallback for cost
select
  count(*) filter (where unit_cost is null and quantity > 0) as in_stock_legacy_rows,
  count(*) filter (where unit_cost is null) as all_legacy_rows
from public.inventory;

-- 2) Inspect sample legacy rows (optional)
-- select id, product_id, product_spec_id, quantity, unit_cost, purchase_date
-- from public.inventory
-- where unit_cost is null and quantity > 0
-- limit 20;

-- 3) One-time backfill — copy CURRENT catalog price into unit_cost for every NULL row.
-- Run only when today’s catalog prices are the costs you want frozen for history.
-- If you already changed catalog prices, this will bake in the wrong numbers for old stock.
update public.inventory i
set unit_cost = ps.price
from public.product_specs ps
where ps.id = i.product_spec_id
  and i.unit_cost is null;

-- 4) Re-verify after backfill
select
  count(*) filter (where unit_cost is null and quantity > 0) as remaining_in_stock_legacy
from public.inventory;
