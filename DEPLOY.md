# alex – Step-by-step: Supabase, Railway, Cloudflare

Follow these in order. You’ll need accounts on [Supabase](https://supabase.com), [Railway](https://railway.app), and [Cloudflare](https://dash.cloudflare.com) (with your domain jawnix on Cloudflare).

---

## Part 1: Supabase (database)

1. **Sign in** at [supabase.com](https://supabase.com) and open the dashboard.

2. **New project**
   - Click **New project**.
   - Pick an organization (or create one).
   - **Name:** e.g. `alex` or `jawnix-alex`.
   - **Database password:** set a strong password and **save it** (you need it only if you use the DB directly).
   - **Region:** choose one close to you or your users.
   - Click **Create new project** and wait until it’s ready.

3. **Run the schema**
   - In the left sidebar, open **SQL Editor**.
   - Click **New query**.
   - Open the file `backend/supabase/schema.sql` from this repo and copy its full contents into the editor.
   - Click **Run** (or Cmd/Ctrl+Enter).
   - You should see “Success. No rows returned.”

4. **Get API keys**
   - Left sidebar → **Project Settings** (gear) → **API**.
   - Copy and save:
     - **Project URL** (e.g. `https://xxxxx.supabase.co`).
     - **service_role** key (under “Project API keys”) — **keep this secret**; it bypasses Row Level Security.

You’ll use **Project URL** and **service_role** in Railway next.

---

## Part 2: Railway (API backend)

1. **Sign in** at [railway.app](https://railway.app) and open the dashboard.

2. **New project**
   - Click **New Project**.
   - Choose **Deploy from GitHub repo** (or “Empty project” if you’ll connect the repo later).
   - If you use GitHub: select the repo that contains this code and pick the branch (e.g. `main`). Railway will detect the app.

3. **Set root directory**
   - After the project is created, click the service (or **Add service** if the project is empty).
   - **Settings** (or **Variables**) → find **Root Directory** (or **Source**).
   - Set **Root Directory** to `backend` so Railway runs the Node API, not the frontend.
   - Save / redeploy if needed.

4. **Add environment variables**
   - In the same service, open **Variables** (or **Environment**).
   - Add:
     - `SUPABASE_URL` = your Supabase **Project URL** (from Part 1).
     - `SUPABASE_SERVICE_KEY` = your Supabase **service_role** key.
     - `CORS_ORIGIN` = `https://alex.jawnix.com` (and optionally `http://localhost:5173` for local testing, e.g. `https://alex.jawnix.com,http://localhost:5173`).
   - Save. Railway will redeploy with the new vars.

5. **Get the API URL**
   - In the service, open **Settings** → **Networking** or **Domains**.
   - Railway gives a default URL like `https://your-app-name.up.railway.app`, or you can add a **Custom domain**.
   - Copy this URL — this is your **API base URL** (you’ll use it in the frontend on Cloudflare).

6. **Deploy**
   - If you connected a GitHub repo, push a change or trigger a deploy so the latest `backend` code is built and run.
   - Check **Deployments** and logs to confirm the app starts (no errors about missing env vars).

---

## Part 3: Cloudflare (frontend at alex.jawnix.com)

1. **Sign in** at [dash.cloudflare.com](https://dash.cloudflare.com) and select the account that has the **jawnix** domain.

2. **Create a Pages project**
   - Left sidebar → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (or “Direct Upload” if you don’t use Git).
   - If **Connect to Git**: choose your Git provider (e.g. GitHub), authorize, and select the repo and branch that contain this code.

3. **Build settings**
   - **Project name:** e.g. `alex`.
   - **Production branch:** e.g. `main`.
   - **Build configuration:**
     - **Framework preset:** None (or “Static”).
     - **Build command:** leave empty (static site, no build).
     - **Build output directory:** `frontend` (so Cloudflare serves the contents of the `frontend` folder as the site root).
   - Click **Save and Deploy**. Wait for the first deploy to finish.

4. **Point the frontend at your API**
   - In the repo, open `frontend/index.html`.
   - Find the meta tag:  
     `<meta name="api-base" content="http://localhost:3000" />`
   - Change it to your Railway API URL, e.g.:  
     `<meta name="api-base" content="https://your-app-name.up.railway.app" />`  
     (Use the exact URL from Part 2 step 5.)
   - Commit and push so Cloudflare redeploys with the new value.

   Alternatively, if Cloudflare supports **Environment variables** for Pages and you have a way to inject them into HTML (e.g. at build time), you can set the API URL there instead — but the meta tag is the simplest.

5. **Custom domain alex.jawnix.com**
   - In the same Pages project, go to **Custom domains**.
   - Click **Set up a custom domain** (or **Add**).
   - Enter `alex.jawnix.com` and follow the prompts.
   - Cloudflare will add a CNAME (or show you what to add in DNS). If DNS is already on Cloudflare for jawnix, it will often add the record for you.
   - Wait until the domain shows as **Active** (SSL may take a minute).

6. **Verify**
   - Open **https://alex.jawnix.com** in your browser.
   - You should see the alex UI. Use **Manage products** → **Seed PDF data** once to load products, then use Spend / Sales as normal.

---

## Checklist

- [ ] **Supabase:** Project created, schema run, Project URL + service_role copied.
- [ ] **Railway:** Project created, root = `backend`, env vars set (SUPABASE_URL, SUPABASE_SERVICE_KEY, CORS_ORIGIN), deploy successful, API URL copied.
- [ ] **Cloudflare:** Pages project created, output = `frontend`, `api-base` in `index.html` set to Railway API URL, custom domain `alex.jawnix.com` added and active.
- [ ] **Test:** Open alex.jawnix.com → Seed PDF data → add quantity / add sale → confirm Net profit updates.

---

## Troubleshooting

- **Frontend loads but data doesn’t:** Check browser DevTools → Network: requests to your Railway URL should return 200. If they’re blocked, fix CORS: ensure Railway has `CORS_ORIGIN` including `https://alex.jawnix.com`.
- **Railway build fails:** Confirm root directory is `backend` and that `backend/package.json` and `backend/index.js` exist in the repo.
- **Supabase errors in API logs:** Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct and the schema was run (SQL Editor).
