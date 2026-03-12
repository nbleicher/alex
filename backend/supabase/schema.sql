-- Run this in Supabase SQL Editor to create tables.

-- Products (e.g. Semaglutide, Retatrutide)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
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
  created_at timestamptz default now(),
  unique(product_id, spec)
);

-- Inventory: one row per product with selected spec + quantity (Purpose 1)
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  product_spec_id uuid not null references product_specs(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(product_id)
);

-- Sales (Purpose 2)
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  product_spec_id uuid not null references product_specs(id) on delete cascade,
  quantity_sold integer not null check (quantity_sold >= 0),
  sell_price_per_sub numeric(12,2) not null,
  revenue numeric(12,2) not null,
  created_at timestamptz default now()
);

-- Indexes for common lookups
create index if not exists idx_product_specs_product_id on product_specs(product_id);
create index if not exists idx_inventory_product_id on inventory(product_id);
create index if not exists idx_sales_product_id on sales(product_id);
