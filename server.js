/**
 * Software Store — Express server
 * Run:  npm install  ->  cp .env.example .env  ->  npm start
 *
 * Security rules baked in:
 *  1. Prices ALWAYS come from data/products.js on the server.
 *     Anything the browser sends about price is ignored.
 *  2. Payment is only marked "paid" after Razorpay signature
 *     verification (checkout) OR a signed webhook. Never on
 *     a redirect / screenshot alone.
 *  3. All secrets live in .env (server-only). Frontend only
 *     ever receives the Razorpay KEY ID (public by design).
 */
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const PRODUCTS = require("./data/products");
const store = require("./db/database");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config (single place for business settings) ---
const CONFIG = {
  businessName: process.env.BUSINESS_NAME || "Your Business Name",
  supportEmail: process.env.SUPPORT_EMAIL || "support@example.com",
  whatsappNumber: (process.env.WHATSAPP_NUMBER || "919999999999").replace(/\D/g, ""),
};

// Razorpay is optional at boot: no keys = MOCK MODE (clearly labelled, no real money)
let razorpay = null;
// Placeholder values from .env.example count as "not configured" -> Mock Mode
const isPlaceholder = (v) => !v || /xxxx|your_|change-me/i.test(v);
const hasRazorpayKeys = !isPlaceholder(process.env.RAZORPAY_KEY_ID) && !isPlaceholder(process.env.RAZORPAY_KEY_SECRET);
if (hasRazorpayKeys) {
  const Razorpay = require("razorpay");
  razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
} else {
  console.warn("⚠️  Razorpay keys not set — running in MOCK MODE (no real payments). See README > Test Mode.");
}

// Webhook needs the RAW body to verify its signature, so register it BEFORE express.json()
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Webhook secret not configured" });

  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  // timingSafeEqual avoids timing attacks
  const valid = signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!valid) return res.status(400).json({ error: "Invalid webhook signature" });

  const event = JSON.parse(req.body.toString());
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const rzpOrderId = event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
    const paymentId = event.payload?.payment?.entity?.id;
    const order = rzpOrderId && store.getOrderByRazorpayId(rzpOrderId);
    if (order && order.status !== "paid") store.updateOrderStatus(order.id, "paid", paymentId);
  }
  if (event.event === "payment.failed") {
    const rzpOrderId = event.payload?.payment?.entity?.order_id;
    const order = rzpOrderId && store.getOrderByRazorpayId(rzpOrderId);
    if (order && order.status === "pending") store.updateOrderStatus(order.id, "failed");
  }
  res.json({ ok: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers ----------
function makeOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `ORD-${date}-${rand}`;
}
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");
const isPhone = (v) => /^[+\d][\d\s-]{9,14}$/.test((v || "").trim());

/** Validate a cart against the SERVER catalog. Returns {items, subtotal,total} or {error}. */
function validateCart(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return { error: "Your cart is empty." };
  const items = [];
  let total = 0;
  for (const line of cartItems) {
    const product = PRODUCTS.find((p) => p.id === line.id && p.active !== false);
    if (!product) return { error: `Product not found: ${line.id}` };
    const qty = product.allowQty ? Math.min(Math.max(parseInt(line.qty, 10) || 1, 1), 10) : 1;
    items.push({ id: product.id, name: product.name, price: product.price, type: product.type, qty });
    total += product.price * qty;
  }
  return { items, subtotal: total, total };
}

// ---------- Public API ----------

// Public config for the frontend (NO secrets — key_id is safe to expose, key_secret never is)
app.get("/api/config", (_req, res) => {
  res.json({
    businessName: CONFIG.businessName,
    supportEmail: CONFIG.supportEmail,
    whatsappNumber: CONFIG.whatsappNumber,
    razorpayKeyId: hasRazorpayKeys ? process.env.RAZORPAY_KEY_ID : null,
    mockMode: !hasRazorpayKeys,
  });
});

app.get("/api/products", (_req, res) => {
  res.json(PRODUCTS.filter((p) => p.active !== false));
});

// Create a pending order (+ Razorpay order when configured)
app.post("/api/orders", async (req, res) => {
  try {
    const { name, email, phone, items } = req.body || {};
    if (!name || name.trim().length < 2) return res.status(400).json({ error: "Please enter your full name." });
    if (!isEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!isPhone(phone)) return res.status(400).json({ error: "Please enter a valid phone number." });

    const checked = validateCart(items);
    if (checked.error) return res.status(400).json({ error: checked.error });

    const orderId = makeOrderId();
    const now = new Date().toISOString();
    let razorpayOrderId = null;

    if (razorpay) {
      const rzpOrder = await razorpay.orders.create({
        amount: checked.total * 100, // Razorpay works in paise
        currency: "INR",
        receipt: orderId,
        notes: { customer_email: email },
      });
      razorpayOrderId = rzpOrder.id;
    }

    store.createOrder({
      id: orderId, customer_name: name.trim(), email: email.trim(), phone: phone.trim(),
      items: JSON.stringify(checked.items), subtotal: checked.subtotal, total: checked.total,
      currency: "INR", status: "pending", razorpay_order_id: razorpayOrderId,
      created_at: now, updated_at: now,
    });

    res.status(201).json({ orderId, razorpayOrderId, amount: checked.total, currency: "INR", mockMode: !razorpay });
  } catch (err) {
    console.error("Create order failed:", err);
    res.status(500).json({ error: "Could not create your order. Please try again." });
  }
});

// Verify a Razorpay checkout payment (official signature check)
app.post("/api/payments/verify", (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const order = orderId && store.getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!hasRazorpayKeys) return res.status(400).json({ error: "Payment gateway is not configured." });

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const valid = razorpay_signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!valid) return res.status(400).json({ error: "Payment verification failed. If money was deducted, contact support with your order reference." });

  store.updateOrderStatus(orderId, "paid", razorpay_payment_id);
  res.json({ ok: true, status: "paid" });
});

// MOCK ONLY: simulate a successful payment for local UI testing (disabled when real keys exist)
app.post("/api/payments/mock-success", (req, res) => {
  if (hasRazorpayKeys) return res.status(403).json({ error: "Mock mode is disabled when Razorpay is configured." });
  const order = store.getOrder(req.body?.orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  store.updateOrderStatus(order.id, "paid", "pay_MOCK_test");
  res.json({ ok: true, status: "paid" });
});

// Order status (confirmation page polls this)
app.get("/api/orders/:id", (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({
    id: order.id, status: order.status, total: order.total, currency: order.currency,
    customerName: order.customer_name, items: JSON.parse(order.items), createdAt: order.created_at,
    whatsappNumber: CONFIG.whatsappNumber, businessName: CONFIG.businessName,
  });
});

// ---------- Admin (local development only) ----------
// Before a real launch: replace this with proper login/auth and put it behind HTTPS.
app.get("/admin/orders", (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized. Open /admin/orders?token=YOUR_ADMIN_TOKEN (set in .env)");
  }
  const rows = store.listOrders().map((o) => `
    <tr><td>${o.id}</td><td>${o.customer_name}<br><small>${o.email} · ${o.phone}</small></td>
    <td>₹${o.total}</td><td>${o.status}</td><td>${new Date(o.created_at).toLocaleString("en-IN")}</td></tr>`).join("");
  res.send(`<!doctype html><title>Orders — Admin</title>
    <style>body{font-family:system-ui;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style>
    <h1>Orders (latest 100)</h1><p>Local dev view only. Add real authentication before launch.</p>
    <table><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Created</th></tr>${rows || '<tr><td colspan="5">No orders yet.</td></tr>'}</table>`);
});

app.listen(PORT, () => console.log(`✅ Store running at http://localhost:${PORT}  (${hasRazorpayKeys ? "Razorpay: configured" : "Razorpay: MOCK MODE"})`));
