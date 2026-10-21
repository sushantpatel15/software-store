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

## 2. Edit products & prices ★

**Edit only this file: `data/products.js`**

- All 50 products from your list are already there, grouped by category.
- Prices are `0` right now because no prices were provided. `price: 0` = shows **"Price on request" + WhatsApp enquiry button**.
- Set a real price (e.g. `price: 1499`) and that product automatically gets a price + **Add to Cart** + checkout.
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
- Review orders: http://localhost:3000/admin/orders?token=YOUR_ADMIN_TOKEN (token from `.env`).

## 6. Project structure

```
data/products.js    ★ products & prices (single source of truth)
db/database.js      SQLite setup & order helpers
server.js           Express API, Razorpay verify + webhook, admin
public/             index, checkout, confirmation, terms/privacy/refund, css/, js/ (cart in localStorage)
.env.example        copy to .env — placeholders only
```

## 7. Before a real launch — checklist

- [ ] Replace template Terms / Privacy / Refund pages with real, reviewed policies
- [ ] Switch to Razorpay **live** keys, complete KYC, test a real low-value order + refund
- [ ] Replace token-in-URL admin with proper login/auth; serve everything over **HTTPS**
- [ ] Set a strong `ADMIN_TOKEN`, keep `.env` out of Git, back up `db/store.db`
- [ ] Consider a hosted DB (Postgres etc.) if traffic grows; SQLite is for starting out
- [ ] Confirm you are authorised to resell each subscription and comply with each provider's resale terms
- [ ] Add order emails / delivery automation for licences & activation

## Deployment guidance

Any Node host works (Render, Railway, Fly.io, a VPS with PM2 + Nginx reverse proxy). Set all `.env` values in the host's environment settings, persist the `db/` folder (or migrate DB), point your domain + HTTPS at the app, then update the Razorpay webhook URL to the live domain.
