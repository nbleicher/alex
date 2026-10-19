# alex – Spend & Profit Tracker

Full-stack app on one Vercel project (`alex`, team Momentum Media Solutions LLC):

- **Frontend** – admin-only static files in `frontend/`, served at the site root (alex.jawnix.com). There is no storefront.
- **API** – Express app in `api/index.js` + `backend/`, one Vercel function under `/api`.
- **DB** – Neon Postgres (`alex-db`, via the Vercel Marketplace). Images – Vercel Blob (`alex-images`).

---

## Local dev

1. `npm install`
2. `vercel link --project alex --scope pro-build-momentum` then `vercel env pull .env.local`
3. Add `ADMIN_SESSION_SECRET` to `.env.local` (it is sensitive on Vercel, so `env pull` leaves it out).
4. `npm run dev` → http://localhost:3000 (static site + `/api`).

Schema: run `backend/sql/schema.sql` once in the Neon SQL Editor. Seed: Manage products → “Seed PDF data”, or `npm run seed`.

Admin login lives in the `admin_users` table. `npm run set-admin-password -- <username> <password>` creates the admin or resets the password. Either way, a new password is required at the next login.

See [DEPLOY.md](DEPLOY.md) for deploys and the Supabase data migration.

## API

All routes are under `/api`.

- `GET/POST /products` – list, create
- `GET/PATCH/DELETE /products/:id` – get, update, delete product
- `GET/POST /products/:id/specs` – list specs, add spec
- `PATCH/DELETE /specs/:id` – update, delete spec
- `POST /specs/:id/image` – upload spec image to Vercel Blob
- `GET/PUT /inventory` – list, upsert (product_id, product_spec_id, quantity)
- `GET/POST /sales` – list, add sale
- `PATCH/DELETE /sales/:id` – edit, remove sale
- `GET /summary` – totalSpend, totalRevenue, netProfit
- `GET /orders`, `PATCH /orders/:id/status`, `PATCH /orders/:id/items`, `DELETE /orders/:id` – orders board
- `POST /seed` – seed products/specs from PDF data
