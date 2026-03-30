-- Run this in Supabase SQL Editor to create tables.

-- Products (e.g. Semaglutide, Retatrutide)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  available boolean not null default false,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Specs per product (e.g. 5mg $37, 10mg $48)
create table if not exists product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  spec text not null,
  price numeric(12,2) not null,
  cat_no text,
  image_url text,
  created_at timestamptz default now(),
  unique(product_id, spec)
);

alter table if exists products add column if not exists available boolean not null default false;
alter table if exists products add column if not exists image_url text;
alter table if exists product_specs add column if not exists image_url text;

-- Inventory: purchase lines (multiple rows per product+spec allowed for cost history)
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  product_spec_id uuid not null references product_specs(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  unit_cost numeric(12,2),
  status text,
  purchase_date timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Migration for existing projects
alter table if exists inventory drop constraint if exists inventory_product_id_key;
drop index if exists inventory_product_id_key;
alter table if exists inventory drop constraint if exists inventory_product_id_product_spec_id_key;
alter table if exists inventory add column if not exists status text;
update inventory set status = null where trim(coalesce(status, '')) = '';
alter table if exists inventory add column if not exists unit_cost numeric(12,2);
create index if not exists idx_inventory_product_spec on inventory(product_id, product_spec_id);

-- Optional: verify / backfill unit_cost for rows still following catalog — see backfill-unit-cost.sql

-- Sales (Purpose 2)
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  product_spec_id uuid not null references product_specs(id) on delete cascade,
  quantity_sold integer not null check (quantity_sold >= 0),
  sell_price_per_sub numeric(12,2) not null,
  revenue numeric(12,2) not null,
  created_at timestamptz default now(),
  client_name text
);

-- Indexes for common lookups
create index if not exists idx_product_specs_product_id on product_specs(product_id);
create index if not exists idx_inventory_product_id on inventory(product_id);
create index if not exists idx_sales_product_id on sales(product_id);

-- Manual summary overrides (permanent with history for totals)
create table if not exists summary_overrides (
  id uuid primary key default gen_random_uuid(),
  manual_total_spend numeric(12,2),
  manual_total_revenue numeric(12,2),
  spend_adjustment numeric(12,2),
  reason text,
  effective_from timestamptz default now(),
  created_at timestamptz default now()
);
alter table if exists summary_overrides add column if not exists spend_adjustment numeric(12,2);

-- Consumer orders
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  first_name text not null,
  last_name text not null,
  phone text not null,
  referral text,
  status text not null default 'processing' check (status in ('processing', 'payment_received', 'fulfilled')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  product_spec_id uuid not null references product_specs(id) on delete restrict,
  product_name_snapshot text not null,
  spec_snapshot text not null,
  ordered_quantity integer not null check (ordered_quantity > 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

create table if not exists order_item_reservations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  inventory_id uuid not null references inventory(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz default now()
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_created_at on orders(created_at);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_items_spec on order_items(product_spec_id);
create index if not exists idx_order_item_reservations_item_id on order_item_reservations(order_item_id);
create index if not exists idx_order_item_reservations_inventory_id on order_item_reservations(inventory_id);
