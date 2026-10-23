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
const adminStore = require("./db/admin-store");
const createAdminRouter = require("./src/admin-routes");

const app = express();
// On Render (behind a proxy) this makes req.ip / secure-cookie detection correct
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// --- Config (single place for business settings) ---
const CONFIG = {
  businessName: process.env.BUSINESS_NAME || "Software Store",
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
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
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
    const order = rzpOrderId && await store.getOrderByRazorpayId(rzpOrderId);
    if (order && order.status !== "paid") await store.updateOrderStatus(order.id, "paid", paymentId);
  }
  if (event.event === "payment.failed") {
    const rzpOrderId = event.payload?.payment?.entity?.order_id;
    const order = rzpOrderId && await store.getOrderByRazorpayId(rzpOrderId);
    if (order && order.status === "pending") await store.updateOrderStatus(order.id, "failed");
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
    // Only a valid, non-placeholder number is exposed; otherwise null (frontend shows a helpful error)
    whatsappNumber: getWhatsappNumber(),
    whatsappReady: Boolean(getWhatsappNumber()),
    razorpayKeyId: hasRazorpayKeys ? process.env.RAZORPAY_KEY_ID : null,
    mockMode: !hasRazorpayKeys,
  });
});

app.get("/api/products", (_req, res) => {
  res.json(PRODUCTS.filter((p) => p.active !== false));
});

// ---------- WhatsApp order enquiry (NO payment, NO database, NO Razorpay) ----------
// The customer's cart is checked against the SERVER catalog, a WhatsApp message is
// built here, and the browser opens it via https://wa.me/. Nothing is stored or logged.
const ENQUIRY_MAX_ITEMS = 20;
const ENQUIRY_MAX_QTY = 10;
const PLACEHOLDER_WHATSAPP = "919999999999"; // value from .env.example = "not configured yet"
const WARRANTY_LABELS = { FW: "Full Warranty (FW)", NW: "Non-Warranty (NW)", NONE: "No preference" };

/** Returns the WhatsApp number (digits only, E.164 length) or null if missing/invalid/placeholder. */
function getWhatsappNumber() {
  const n = (process.env.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  if (!/^[1-9]\d{9,14}$/.test(n) || n === PLACEHOLDER_WHATSAPP) return null;
  return n;
}
const inrText = (n) => "₹" + Number(n).toLocaleString("en-IN");
const phoneDigits = (v) => String(v || "").replace(/\D/g, "").length;
const isPhoneStrict = (v) => isPhone(v) && phoneDigits(v) >= 10 && phoneDigits(v) <= 15;

/** Trim, drop control characters, cap length. Single-line fields also collapse whitespace. */
function cleanText(v, max, multiline = false) {
  if (v === undefined || v === null || typeof v === "object") return "";
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = multiline ? s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

/** Strictly validates cart lines against the catalog. Prices come ONLY from data/products.js. */
function validateEnquiryItems(items) {
  if (!Array.isArray(items) || items.length === 0) return { error: "Your cart is empty." };
  if (items.length > ENQUIRY_MAX_ITEMS) return { error: `Please send at most ${ENQUIRY_MAX_ITEMS} different products per enquiry.` };
  const lines = [], seen = new Set();
  for (const line of items) {
    if (!line || typeof line !== "object" || typeof line.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(line.id))
      return { error: "One of the cart items is invalid. Please refresh the page and review your cart." };
    const product = PRODUCTS.find((p) => p.id === line.id);
    if (!product) return { error: "A product in your cart no longer exists. Please refresh the page and review your cart." };
    if (product.active === false) return { error: `"${product.name}" is not available right now. Please remove it from your cart.` };
    if (seen.has(product.id)) return { error: "Your cart has the same product more than once. Please refresh and try again." };
    seen.add(product.id);
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > ENQUIRY_MAX_QTY)
      return { error: `Quantity for "${product.name}" must be a whole number from 1 to ${ENQUIRY_MAX_QTY}.` };
    if (!product.allowQty && line.qty !== 1)
      return { error: `"${product.name}" can only be ordered with quantity 1.` };
    const price = Number(product.price) > 0 ? Number(product.price) : null; // null = price on request
    lines.push({ name: product.name, qty: line.qty, price });
  }
  return { lines };
}

/** Builds the WhatsApp message text (plain text; WhatsApp renders *bold*). */
function buildEnquiryMessage({ reference, customer, lines, details }) {
  const hasUnknown = lines.some((l) => l.price === null);
  const out = [];
  out.push(`*New order enquiry — ${CONFIG.businessName}*`, `Reference: ${reference}`, "");
  out.push("*Customer*", `Name: ${customer.name}`, `Email: ${customer.email}`, `Phone: ${customer.phone}`, "");
  out.push("*Items*");
  lines.forEach((l, i) => {
    const price = l.price === null
      ? "Price on request"
      : `${inrText(l.price)} each = ${inrText(l.price * l.qty)}`;
    out.push(`${i + 1}. ${l.name} × ${l.qty} — ${price}`);
  });
  if (hasUnknown) {
    out.push("", "Total: Final quotation required (one or more items are Price on request).");
  } else {
    const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
    out.push("", `Subtotal: ${inrText(subtotal)}`);
  }
  const req = [];
  if (details.plan) req.push(`Plan: ${details.plan}`);
  if (details.duration) req.push(`Duration: ${details.duration}`);
  if (details.warranty) req.push(`Warranty preference: ${WARRANTY_LABELS[details.warranty]}`);
  if (details.notes) req.push(`Notes: ${details.notes}`);
  if (req.length) out.push("", "*Requirements*", ...req);
  out.push("", "Please confirm availability, the final quote and the next steps. Payment will be discussed after you confirm. Thank you!");
  return { message: out.join("\n"), hasUnknown };
}

// Validate an order enquiry and return a ready-to-open WhatsApp link.
app.post("/api/enquiries", (req, res) => {
  const whatsapp = getWhatsappNumber();
  if (!whatsapp) {
    return res.status(503).json({ error: `WhatsApp ordering is not available right now. Please email us at ${CONFIG.supportEmail}.` });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const customer = {
    name: cleanText(body.name, 100),
    email: cleanText(body.email, 254),
    phone: cleanText(body.phone, 20),
  };
  const warrantyRaw = cleanText(body.warranty, 10).toUpperCase();
  const details = {
    plan: cleanText(body.plan, 100),
    duration: cleanText(body.duration, 60),
    warranty: warrantyRaw,
    notes: cleanText(body.notes, 500, true),
  };

  const fields = {};
  if (customer.name.length < 2) fields.name = "Please enter your full name.";
  if (!isEmail(customer.email)) fields.email = "Please enter a valid email address.";
  if (!isPhoneStrict(customer.phone)) fields.phone = "Please enter a valid phone number (10–15 digits, e.g. +91 98765 43210).";
  if (details.warranty && !WARRANTY_LABELS[details.warranty]) fields.warranty = "Please choose a valid warranty option.";
  if (Object.keys(fields).length) {
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }

  const checked = validateEnquiryItems(body.items);
  if (checked.error) return res.status(400).json({ error: checked.error });

  const reference = `ENQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const { message, hasUnknown } = buildEnquiryMessage({ reference, customer, lines: checked.lines, details });
  const encoded = encodeURIComponent(message);
  if (encoded.length > 6000) {
    return res.status(400).json({ error: "Your enquiry is too long. Please shorten the notes or reduce the number of products." });
  }
  res.json({
    reference,
    message,
    quotationRequired: hasUnknown,
    whatsappUrl: `https://wa.me/${whatsapp}?text=${encoded}`,
  });
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

    await store.createOrder({
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
app.post("/api/payments/verify", async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const order = orderId && await store.getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!hasRazorpayKeys) return res.status(400).json({ error: "Payment gateway is not configured." });

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const valid = razorpay_signature && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!valid) return res.status(400).json({ error: "Payment verification failed. If money was deducted, contact support with your order reference." });

  await store.updateOrderStatus(orderId, "paid", razorpay_payment_id);
  res.json({ ok: true, status: "paid" });
});

// MOCK ONLY: simulate a successful payment for local UI testing (disabled when real keys exist)
app.post("/api/payments/mock-success", async (req, res) => {
  if (hasRazorpayKeys) return res.status(403).json({ error: "Mock mode is disabled when Razorpay is configured." });
  const order = await store.getOrder(req.body?.orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });
  await store.updateOrderStatus(order.id, "paid", "pay_MOCK_test");
  res.json({ ok: true, status: "paid" });
});

// Order status (confirmation page polls this)
app.get("/api/orders/:id", async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({
    id: order.id, status: order.status, total: order.total, currency: order.currency,
    customerName: order.customer_name, items: JSON.parse(order.items), createdAt: order.created_at,
    whatsappNumber: CONFIG.whatsappNumber, businessName: CONFIG.businessName,
  });
});

// ---------- Admin dashboard (email + password login) ----------
// Products & availability are editable in the dashboard; PRODUCTS is refreshed in place so the storefront updates instantly.
// If the database can't start, the storefront keeps running with the catalog in data/products.js.
app.use("/admin", createAdminRouter({ catalog: PRODUCTS }));

// Malformed JSON bodies get a clean JSON error instead of an HTML stack page
app.use((err, _req, res, next) => {
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
  next(err);
});

(async () => {
  try {
    await adminStore.init(PRODUCTS);

    app.listen(PORT, () => {
      console.log(
        `Store running at http://localhost:${PORT} (${hasRazorpayKeys ? "Razorpay: configured" : "Razorpay: MOCK MODE"})`
      );
    });
  } catch (err) {
    console.error(
      "Database initialization failed; server will not start:",
      err.message
    );
    process.exitCode = 1;
  }
})();