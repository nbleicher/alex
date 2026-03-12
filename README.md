# alex – Spend & Profit Tracker

Full-stack app: **frontend** (Cloudflare / alex.jawnix.com), **API** (Railway), **DB** (Supabase).

---

## Full-stack local (quick start)

1. **Supabase** – Create a project, run `backend/supabase/schema.sql` in SQL Editor, copy URL + service_role key.
2. **Backend env** – `cd backend && cp .env.example .env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Optionally set `CORS_ORIGIN=http://localhost:5173`.
3. **Install** – From repo root: `npm run setup` (installs backend deps).
4. **Run** – Two terminals:
   - Terminal 1: `npm run dev:api`  → API at http://localhost:3000
   - Terminal 2: `npm run dev:web`  → Frontend at http://localhost:5173
5. **Open** – http://localhost:5173 (uses API at 3000 via meta tag in `index.html`).
6. **Seed** – In the app: Manage products → “Seed PDF data”. Or: `curl -X POST http://localhost:3000/seed`.

---

## Setup (detailed)

### 1. Supabase

- Create a project at [supabase.com](https://supabase.com).
- In SQL Editor, run the schema: `backend/supabase/schema.sql`.
- Copy **Project URL** and **service_role key** (Settings → API).

### 2. Backend (Railway)

```bash
cd backend
cp .env.example .env
# Edit .env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CORS_ORIGIN (e.g. https://alex.jawnix.com)
npm install
npm run dev   # local: http://localhost:3000
```

- Deploy to Railway: connect the repo, set root to `backend`, add env vars. Note the Railway URL (e.g. `https://alex-api.railway.app`).

### 3. Seed products (optional)

One-time load of PEPITEDE PDF data:

- **Via API** (after backend is running): `curl -X POST https://your-api-url/seed`
- **Via script**: `cd backend && npm run seed` (requires `dotenv` and `.env`)

Add `dotenv` for the script: `npm install dotenv` in backend.

### 4. Frontend (Cloudflare Pages)

- Build: static files in `frontend/` (no build step; serve `index.html`, `styles.css`, `app.js`).
- Set **API base URL**: before loading the app, set `window.API_BASE_URL = 'https://your-railway-url'` (e.g. in a small inline script in `index.html` or via Cloudflare env / build).
- Deploy: connect repo to Cloudflare Pages, set root to `frontend`, or build output to `frontend`. Add custom domain **alex.jawnix.com**.

## Local dev

1. Start API: `cd backend && npm run dev`
2. Serve frontend: from repo root, `npx serve frontend` or open `frontend/index.html` (CORS will block API calls; use a simple static server and set `API_BASE_URL=http://localhost:3000`).

## API

- `GET/POST /products` – list, create
- `GET/PATCH/DELETE /products/:id` – get, update, delete product
- `GET/POST /products/:id/specs` – list specs, add spec
- `PATCH/DELETE /specs/:id` – update, delete spec
- `GET/PUT /inventory` – list, upsert (product_id, product_spec_id, quantity)
- `GET/POST /sales` – list, add sale
- `DELETE /sales/:id` – remove sale
- `GET /summary` – totalSpend, totalRevenue, netProfit
- `POST /seed` – seed products/specs from PDF data
