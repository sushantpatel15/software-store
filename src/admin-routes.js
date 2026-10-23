/**
 * Admin routes, mounted at /admin.
 *   Public:        GET /admin/login, /admin/assets/*, POST /admin/api/login
 *   Needs login:   GET /admin (dashboard) and everything under /admin/api/*
 *   Needs login + CSRF token for anything that changes data.
 */
const express = require("express");
const path = require("path");
const store = require("../db/admin-store");
const auth = require("./admin-auth");
const { verifyPassword, dummyHash } = require("./password");

const UI = path.join(__dirname, "..", "admin-ui");
const ORDER_STATUSES = ["pending", "paid", "failed", "cancelled"];
const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const clean = (v) => String(v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** catalog = the live PRODUCTS array used by the storefront; it is refreshed in place after every change. */
module.exports = function createAdminRouter({ catalog }) {
  const router = express.Router();
  router.use(auth.securityHeaders);

  // ---------- public pages ----------
  router.get("/login", wrap(async (req, res) => (await auth.currentSession(req) ? res.redirect("/admin") : res.sendFile(path.join(UI, "login.html")))));
  router.use("/assets", express.static(path.join(UI, "assets"), { index: false }));
  router.get("/orders", (_req, res) => res.redirect("/admin")); // old token-in-URL page is retired

  // ---------- login / logout ----------
  router.post("/api/login", wrap(async (req, res) => {
    if (!auth.sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const emailKey = "e:" + email.slice(0, 254), ipKey = "i:" + req.ip;
    if (auth.emailThrottle.blocked(emailKey) || auth.ipThrottle.blocked(ipKey)) {
      const wait = Math.max(auth.emailThrottle.retryAfterSec(emailKey), auth.ipThrottle.retryAfterSec(ipKey));
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: "Too many failed attempts. Please wait a few minutes and try again." });
    }
    if (!isEmail(email) || !password || password.length > 200) { ipFail(ipKey); return res.status(401).json({ error: "Invalid email or password." }); }

    const user = await store.getAdminByEmail(email);
    // Always run one full password check (a dummy one if the email is unknown) so timing doesn't reveal which emails exist.
    const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash());
    if (!user || !ok) { auth.emailThrottle.fail(emailKey); ipFail(ipKey); return res.status(401).json({ error: "Invalid email or password." }); }

    auth.emailThrottle.reset(emailKey);
    await store.touchLogin(user.id);
    await store.purgeSessions(new Date(Date.now() - 30 * 60 * 1000).toISOString());
    const csrf = await auth.startSession(req, res, user); // brand-new token on every login
    await store.audit(user, "login", null, null, req.ip);
    res.json({ email: user.email, csrfToken: csrf });
  }));
  const ipFail = (k) => auth.ipThrottle.fail(k);

  router.post("/api/logout", auth.requireSession, auth.requireCsrf, wrap(async (req, res) => {
    await store.audit(req.admin, "logout", null, null, req.ip);
    await auth.endSession(req, res); res.json({ ok: true });
  }));

  // ---------- dashboard page (login required) ----------
  router.get("/", auth.requireSessionPage, (_req, res) => res.sendFile(path.join(UI, "dashboard.html")));

  // ---------- everything below needs a session; changes also need CSRF ----------
  router.use("/api", auth.requireSession, auth.requireCsrf);

  router.get("/api/me", (req, res) => res.json({ email: req.admin.email, csrfToken: req.admin.csrf }));
  router.get("/api/summary", wrap(async (_req, res) => res.json(await store.summary())));

  // ----- products -----
  function parseProduct(body, partial) {
    const out = {}, errors = {}; const b = body && typeof body === "object" ? body : {};
    const text = (k, label, min, max) => {
      if (b[k] === undefined) { if (!partial && min > 0) errors[k] = `${label} is required.`; return; }
      if (typeof b[k] !== "string") { errors[k] = `${label} must be text.`; return; }
      const v = clean(b[k]); if (v.length < min || v.length > max) errors[k] = `${label} must be ${min ? min + "–" : "up to "}${max} characters.`; else out[k] = v;
    };
    if (!partial) {
      if (typeof b.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(b.id)) errors.id = "ID: lowercase letters, numbers and dashes only (max 80), e.g. my-product.";
      else out.id = b.id;
    }
    text("name", "Name", 2, 120); text("category", "Category", 1, 60); text("description", "Description", 0, 500);
    if (b.price !== undefined) { if (!Number.isInteger(b.price) || b.price < 0 || b.price > 10000000) errors.price = "Price must be a whole number of rupees from 0 to 10,000,000 (0 = price on request)."; else out.price = b.price; }
    if (b.type !== undefined) { if (!["subscription", "one-time"].includes(b.type)) errors.type = "Choose subscription or one-time."; else out.type = b.type; }
    if (b.period !== undefined) { if (!["", "month", "year", null].includes(b.period)) errors.period = "Choose month, year or none."; else out.period = b.period || null; }
    for (const k of ["allowQty", "active"]) if (b[k] !== undefined) { if (typeof b[k] !== "boolean") errors[k] = "Must be true or false."; else out[k] = b[k]; }
    return { out, errors };
  }
  const bad = (res, errors) => res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });

  router.get("/api/products", wrap(async (_req, res) => res.json(await store.listProducts())));

  router.post("/api/products", wrap(async (req, res) => {
    const { out, errors } = parseProduct(req.body, false);
    if (Object.keys(errors).length) return bad(res, errors);
    if (await store.getProduct(out.id)) return bad(res, { id: "A product with this ID already exists." });
    const p = { description: `${out.name} — contact us for available plan, duration, and warranty (FW/NW) options.`, price: 0, type: "subscription", allowQty: false, active: true, ...out };
    await store.insertProduct(p); await store.refreshCatalog(catalog);
    await store.audit(req.admin, "product.create", p.id, { name: p.name, price: p.price, active: p.active }, req.ip);
    res.status(201).json(await store.getProduct(p.id));
  }));

  router.patch("/api/products/:id", wrap(async (req, res) => {
    const before = await store.getProduct(req.params.id);
    if (!before) return res.status(404).json({ error: "Product not found." });
    const { out, errors } = parseProduct(req.body, true);
    if (Object.keys(errors).length) return bad(res, errors);
    const changes = {};
    for (const [k, v] of Object.entries(out)) if ((before[k] ?? null) !== v) changes[k] = { from: before[k] ?? null, to: v };
    if (Object.keys(changes).length) {
      await store.updateProduct(before.id, out); await store.refreshCatalog(catalog); // storefront sees it immediately
      await store.audit(req.admin, "product.update", before.id, changes, req.ip);
    }
    res.json(await store.getProduct(before.id));
  }));
  // (No delete on purpose: hide a product with active=false so past orders keep making sense.)

  // ----- orders -----
  router.get("/api/orders", wrap(async (req, res) => {
    const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : "";
    const q = typeof req.query.q === "string" ? clean(req.query.q).slice(0, 80) : "";
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100), offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { total, rows } = await store.listOrders({ status, q, limit, offset });
    res.json({ total, orders: rows.map((o) => ({ id: o.id, customerName: o.customer_name, email: o.email, phone: o.phone, total: o.total, currency: o.currency, status: o.status, createdAt: o.created_at, itemCount: safeItems(o.items).reduce((n, i) => n + (i.qty || 0), 0) })) });
  }));
  const safeItems = (json) => { try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; } };
  const ORDER_ID = /^ORD-\d{8}-[0-9A-F]{6}$/;

  router.get("/api/orders/:id", wrap(async (req, res) => {
    const o = ORDER_ID.test(req.params.id) && await store.getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found." });
    res.json({ id: o.id, customerName: o.customer_name, email: o.email, phone: o.phone, items: safeItems(o.items), total: o.total, currency: o.currency, status: o.status, paymentReference: o.razorpay_payment_id || null, createdAt: o.created_at, updatedAt: o.updated_at });
  }));
  router.patch("/api/orders/:id", wrap(async (req, res) => {
    const o = ORDER_ID.test(req.params.id) && await store.getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found." });
    const status = req.body && req.body.status;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${ORDER_STATUSES.join(", ")}.` });
    if (status !== o.status) {
      await store.updateOrderStatus(o.id, status); // existing helper; payment IDs are never changed here
      await store.audit(req.admin, "order.status", o.id, { from: o.status, to: status, manual: true }, req.ip);
    }
    res.json({ id: o.id, status });
  }));

  router.get("/api/audit", wrap(async (_req, res) => {
    const rows = await store.listAudit(100);
    res.json(rows.map((a) => ({ id: a.id, admin: a.admin_email, action: a.action, target: a.target, detail: a.detail ? JSON.parse(a.detail) : null, ip: a.ip, at: a.created_at })));
  }));

  router.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  // Never leak internals; details go to the server log only (no request bodies, no personal data).
  router.use((err, _req, res, _next) => { console.error("Admin error:", err && err.message); res.status(500).json({ error: "Something went wrong. Please try again." }); });
  return router;
};
