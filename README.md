# Premium Software & AI Subscriptions — Store

A beginner-friendly store: **HTML + CSS + Vanilla JS** frontend, **Node.js + Express** backend, **SQLite** database, **Razorpay** for UPI/card payments in India. No frontend framework.

## 1. Install & run locally

Requires **Node.js 22+** (uses Node's built-in SQLite — no native build step).

```bash
npm install
cp .env.example .env     # then edit .env (see sections 3 & 4)
npm start                # or: npm run dev  (auto-restart)
```
Open http://localhost:3000

## 0. How ordering works now (WhatsApp enquiry — no online payment)

1. Customer adds **any active product** to the cart (including "Price on request" ones).
2. On **Checkout** they enter name, email, phone and optional plan / duration / warranty (FW/NW) / notes, then press **Send Order on WhatsApp**.
3. The server (`POST /api/enquiries`) re-checks the cart against `data/products.js` (browser prices are never trusted), builds the message with a reference like `ENQ-20261022-A1B2C3`, and returns a `https://wa.me/<WHATSAPP_NUMBER>?text=…` link.
4. WhatsApp opens with the message ready. **The customer must press Send in WhatsApp** — nothing is sent automatically. You then quote, take payment and deliver manually.
5. If any item is "Price on request" the message says "Final quotation required" instead of showing a total.

Nothing is saved to the database and no personal details are logged for enquiries. The Razorpay routes (`/api/orders`, `/api/payments/verify`, webhook) are still in the code for later but the checkout page no longer calls them.
`WHATSAPP_NUMBER` must be a real number (the `919999999999` placeholder counts as "not configured" and checkout will show an error instead of a broken link).

Run the automated tests with `npm test`.

## 2. Edit products & prices ★

**Easiest: sign in to the admin dashboard (section 8) and edit products, prices and availability there.** `data/products.js` is the *starting* catalog: it seeds the database once, and later only adds products whose ID isn't in the database yet.

- All 50 products from your list are already there, grouped by category.
- Prices are `0` right now because no prices were provided. `price: 0` = shows **"Price on request"** (can still be added to the cart; you quote it manually).
- Set a real price (e.g. `price: 1499`) and the product shows that price, and the WhatsApp message includes the line total.
- `active: false` hides a product and the server rejects it.
- Add variants (duration / FW / NW) as separate entries with their own `id` and price once you know them.
- Restart the server after editing.

## 3. WhatsApp number ★

In `.env` (one place only):
```
WHATSAPP_NUMBER=919876543210
```
Format: country code + number, no `+`, no spaces. Used for enquiry buttons and the post-payment WhatsApp button on the confirmation page (prefilled with order reference + customer name; screenshot is optional, never required for verification).

## 4. Payment gateway — Razorpay ★ (settings you must provide)

In `.env`:
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```
1. Create an account at https://dashboard.razorpay.com and complete KYC for live mode.
2. Keys: Dashboard → Settings → API Keys.
3. Webhook: Dashboard → Settings → Webhooks → Add `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment.captured`, `order.paid`, `payment.failed`, copy its secret into `.env`.
4. Secrets stay **server-only** in `.env`. Frontend only receives the public Key ID.

**Payment is NOT live until you add real keys and test end-to-end.** No credentials are invented in this project.

### Test mode guide
- **Mock mode (no keys):** Leave Razorpay keys blank → checkout shows a Mock Mode banner and simulates payment locally. UI testing only, no money moves.
- **Razorpay test mode:** Use `rzp_test_...` keys. Test UPI/card details are in Razorpay's official docs (Dashboard → test mode). Run a full order → verify → webhook flow in test mode before switching to live keys.

**Verification (how it works):** Order is created as `pending` → Razorpay checkout → server verifies `razorpay_signature` with HMAC-SHA256 (`/api/payments/verify`) and also accepts the signed webhook (`/api/webhooks/razorpay`). Only then is status set to `paid`. Redirects/screenshots never mark an order paid.

## 5. Orders & admin (local dev)

- DB file: `db/store.db` (auto-created; orders table: id, customer, items JSON, subtotal/total INR, status, Razorpay IDs, timestamps).
- Review/manage orders in the admin dashboard: http://localhost:3000/admin (see section 8). The old `?token=` page was removed.

## 6. Project structure

```
data/products.js    starting catalog (seeds the database once; after that edit products in /admin)
db/database.js      SQLite setup & order helpers
db/admin-store.js   ALL admin database code (admins, sessions, audit log, editable products)
src/admin-*.js      admin login/session/CSRF logic and API routes; src/password.js = password hashing
admin-ui/           admin login + dashboard pages (served only through /admin)
scripts/            admin-password.js (creates your password hash)
server.js           Express API, Razorpay verify + webhook, admin
public/             index, checkout, confirmation, terms/privacy/refund, css/, js/ (cart in localStorage)
.env.example        copy to .env — placeholders only
```

## 7. Before a real launch — checklist

- [ ] Replace template Terms / Privacy / Refund pages with real, reviewed policies
- [ ] Switch to Razorpay **live** keys, complete KYC, test a real low-value order + refund
- [x] Admin now uses email + password login (section 8). Still serve everything over **HTTPS** and set `NODE_ENV=production`
- [ ] Use a strong admin password, keep `.env` out of Git, back up the database (and put it on a persistent disk — see section 8)
- [ ] Consider a hosted DB (Postgres etc.) if traffic grows; SQLite is for starting out
- [ ] Confirm you are authorised to resell each subscription and comply with each provider's resale terms
- [ ] Add order emails / delivery automation for licences & activation

## 8. Admin dashboard (email + password) ★

**What it does:** sign in at `/admin` to manage **products, prices, availability and orders**. Price and availability changes appear on the storefront immediately. Every change is written to an activity log.

### Set it up (one time)
1. `npm run admin:password` — type your email and a strong password (min 12 characters). It never shows or saves the password; it prints two lines.
2. Paste those two lines (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`) into `.env` locally **and** into Render → Environment. Also set `NODE_ENV=production` on Render.
3. Restart, open `/admin`, sign in. To change the password later, run the script again and replace `ADMIN_PASSWORD_HASH`.

There are **no default credentials**. If the two variables are missing, nobody can sign in.

### How products work now
- On first start, the products in `data/products.js` are copied into the database **once** (existing rows are never overwritten).
- After that, **edit products in the dashboard**. Editing `data/products.js` only adds products whose ID isn't in the database yet.
- Products can be hidden (`Available` off) but not deleted, so old orders still make sense. Price `0` = "Price on request".
- If the database can't start, the storefront keeps running using `data/products.js` and the admin is disabled (check the logs).

### Security design
- Passwords: scrypt hash with per-password salt; compared in constant time; an unknown email takes the same time as a wrong password and gets the same message.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Strict`, `Secure` (production) cookie; only its SHA-256 is stored. Expire after 30 min idle / 8 h total; new token every login; logout ends it server-side.
- CSRF: every change needs a per-session token header **and** a same-origin check.
- Brute force: 5 wrong passwords per email and 20 per IP per 15 minutes → HTTP 429 (kept in memory, resets on restart).
- Headers on admin pages: strict Content-Security-Policy (no inline scripts), no-store, no framing, no referrer.
- The dashboard builds pages with `textContent`, so customer-supplied text (names etc.) can never run as code.
- The activity log never contains passwords, tokens or payment data.

### ⚠ Persistence (important on Render)
SQLite is a file. On Render's free/ephemeral disk it is **wiped on every deploy**, so product edits and orders would be lost. Either attach a **Render Disk** and set `DB_PATH=/var/data/store.db`, or move to Neon/Postgres (below). Your admin login itself survives because it comes from environment variables.

### Moving to Neon / Postgres later
The existing Neon connection isn't part of this codebase (it uses `node:sqlite`), so nothing here touches it. All admin database code is in **`db/admin-store.js`** and the customer/order code in **`db/database.js`**; switching means re-implementing those two files with the `pg` package and a `DATABASE_URL` (Neon needs `?sslmode=require`) — the routes, UI and tests don't change. Tables to create (Postgres):
```sql
CREATE TABLE IF NOT EXISTS admin_users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, admin_id INT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, ip TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS admin_audit (id SERIAL PRIMARY KEY, admin_id INT, admin_email TEXT, action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price INT NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'subscription', period TEXT, allow_qty BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
```
Never run `DROP`/`TRUNCATE` on `orders` when migrating; copy rows across instead. If you want help fixing the Neon connection itself, share the exact error message (without the password) and the file that connects to it.

### Not included yet
Password change from inside the dashboard, multiple admin roles, two-factor sign-in, and a shared (multi-server) login throttle. For a single Render instance, none are required to be safe.

Run all tests with `npm test`.

## Deployment guidance

Any Node host works (Render, Railway, Fly.io, a VPS with PM2 + Nginx reverse proxy). Set all `.env` values in the host's environment settings, persist the `db/` folder (or migrate DB), point your domain + HTTPS at the app, then update the Razorpay webhook URL to the live domain.
