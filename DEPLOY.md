# alex – Deploy on Vercel + Neon

## Resources

- **Vercel project** `alex` in team Momentum Media Solutions LLC, Git-connected to `nbleicher/alex`. Pushing `main` deploys production; other branches get preview URLs.
- **Neon** `alex-db`, installed through the Vercel Marketplace. It sets `DATABASE_URL` (and the other `PG*`/`POSTGRES_*` vars) on the project.
- **Vercel Blob** store `alex-images` (public). It sets `BLOB_READ_WRITE_TOKEN`.
- **Env vars set by hand** (sensitive, Production + Preview): `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`.

`vercel.json` serves `frontend/` as static output and rewrites `/api/*` to the Express function in `api/index.js`. The frontend calls `/api` on the same origin, so no CORS or cross-site cookie settings are needed.

## Schema

Run `backend/sql/schema.sql` once in the Neon SQL Editor (Vercel → Storage → alex-db → Open in Neon).

## Migrating data from Supabase

`npm run migrate:supabase` copies every table from the old Supabase project (`alex-pep`) into Neon and copies spec/product images from Supabase Storage to Vercel Blob, rewriting `image_url`. It empties the Neon tables first, so it can be re-run.

1. `vercel env pull .env.local`
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (Supabase → Project Settings → API → service_role) to `.env.local`.
3. `npm run migrate:supabase` and check the per-table counts it prints.

## Custom domain alex.jawnix.com

1. Vercel → project `alex` → Settings → Domains → add `alex.jawnix.com`.
2. In Cloudflare DNS for jawnix.com, point `alex` at the CNAME Vercel shows, with the proxy set to **DNS only**.
3. Remove the old Cloudflare Pages custom domain and the `api.alex` record (the Railway API is retired).

## Troubleshooting

- **`/api/*` returns 503 “Database not configured”** – `DATABASE_URL` is missing for that environment. Reconnect `alex-db` to the project.
- **Image upload fails** – `BLOB_READ_WRITE_TOKEN` is missing. Reconnect the `alex-images` store to the project.
- **Admin login returns 503** – `ADMIN_USERNAME` / `ADMIN_PASSWORD` are not set for that environment.
