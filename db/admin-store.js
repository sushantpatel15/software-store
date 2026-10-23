/**
 * Storage for the admin system. ALL admin database access lives in this one file,
 * so moving to Postgres/Neon later means rewriting this file only (see README > Admin > Neon).
 *
 * Safety: this file only ever runs CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE.
 * It never drops, truncates or alters the existing `orders` table or any existing data.
 */
const { db, getOrder, updateOrderStatus } = require("./database");
const nowIso = () => new Date().toISOString();

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, last_login_at TEXT
    );
    -- Only a SHA-256 hash of the session token is stored, never the token itself.
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_email TEXT, action TEXT NOT NULL,
      target TEXT, detail TEXT, ip TEXT, created_at TEXT NOT NULL
    );
    -- Editable catalog. Seeded from data/products.js; after that the database copy is the source of truth.
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'subscription', period TEXT,
      allow_qty INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
}

// ---------------- admin users ----------------
const getAdminByEmail = (email) => db.prepare("SELECT * FROM admin_users WHERE email = ?").get(email);
function upsertAdmin(email, passwordHash) {
  const existing = getAdminByEmail(email);
  if (!existing) { db.prepare("INSERT INTO admin_users (email, password_hash, created_at) VALUES (?,?,?)").run(email, passwordHash, nowIso()); return "created"; }
  if (existing.password_hash !== passwordHash) { db.prepare("UPDATE admin_users SET password_hash=? WHERE id=?").run(passwordHash, existing.id); return "updated"; }
  return "unchanged";
}
const touchLogin = (id) => db.prepare("UPDATE admin_users SET last_login_at=? WHERE id=?").run(nowIso(), id);

// ---------------- sessions ----------------
function createSession(s) {
  db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)")
    .run(s.tokenHash, s.adminId, s.csrf, nowIso(), nowIso(), s.expiresAt, s.ip || null, (s.userAgent || "").slice(0, 200));
}
const getSession = (tokenHash) => db.prepare(`SELECT s.*, u.email FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id WHERE s.token_hash = ?`).get(tokenHash);
const touchSession = (tokenHash) => db.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?").run(nowIso(), tokenHash);
const deleteSession = (tokenHash) => db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(tokenHash);
const purgeSessions = (idleCutoffIso) => db.prepare("DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen_at < ?").run(nowIso(), idleCutoffIso);

// ---------------- audit log (never stores passwords, tokens or payment data) ----------------
function audit(admin, action, target, detail, ip) {
  db.prepare("INSERT INTO admin_audit (admin_id, admin_email, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(admin ? admin.id : null, admin ? admin.email : null, action, target || null, detail ? JSON.stringify(detail).slice(0, 1000) : null, ip || null, nowIso());
}
const listAudit = (limit = 100) => db.prepare("SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?").all(limit);

// ---------------- products ----------------
const toProduct = (r) => ({
  id: r.id, name: r.name, category: r.category, description: r.description, price: r.price, type: r.type,
  ...(r.period ? { period: r.period } : {}), allowQty: !!r.allow_qty, active: !!r.active,
});
function seedProducts(list) {
  const ins = db.prepare(`INSERT OR IGNORE INTO products (id,name,category,description,price,type,period,allow_qty,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  list.forEach((p, i) => ins.run(p.id, p.name, p.category || "Software", p.description || "", Math.max(0, Math.round(Number(p.price) || 0)),
    p.type === "one-time" ? "one-time" : "subscription", p.period || null, p.allowQty ? 1 : 0, p.active === false ? 0 : 1, i, nowIso(), nowIso()));
}
const listProducts = () => db.prepare("SELECT * FROM products ORDER BY sort_order, name").all().map(toProduct);
const getProduct = (id) => { const r = db.prepare("SELECT * FROM products WHERE id=?").get(id); return r ? toProduct(r) : null; };
function insertProduct(p) {
  const next = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM products").get().n);
  db.prepare(`INSERT INTO products (id,name,category,description,price,type,period,allow_qty,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.id, p.name, p.category, p.description, p.price, p.type, p.period || null, p.allowQty ? 1 : 0, p.active ? 1 : 0, next, nowIso(), nowIso());
}
const COLUMNS = { name: "name", category: "category", description: "description", price: "price", type: "type", period: "period", allowQty: "allow_qty", active: "active" };
function updateProduct(id, fields) {
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!COLUMNS[k]) continue;
    sets.push(`${COLUMNS[k]} = ?`); vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE products SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, nowIso(), id);
}
/** Replaces the contents of the live `PRODUCTS` array (used by the storefront) with the database copy, in place. */
function refreshCatalog(target) {
  const rows = listProducts();
  if (rows.length) target.splice(0, target.length, ...rows);
}

// ---------------- orders (read + status only; existing table is untouched) ----------------
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);
function listOrders({ status = "", q = "", limit = 25, offset = 0 }) {
  const where = [], args = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (q) { where.push("(id LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"); const l = `%${likeEscape(q)}%`; args.push(l, l, l, l); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT id, customer_name, email, phone, items, total, currency, status, created_at FROM orders ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, rows };
}
function summary() {
  const p = db.prepare("SELECT COUNT(*) AS total, SUM(active) AS active, SUM(CASE WHEN active=1 AND price=0 THEN 1 ELSE 0 END) AS onRequest FROM products").get();
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all();
  return { products: { total: p.total, active: p.active || 0, hidden: p.total - (p.active || 0), priceOnRequest: p.onRequest || 0 }, orders: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) };
}

/** One call at server start. Throws if the database is unavailable (server.js catches it and keeps the storefront running). */
function init(catalogArray) {
  initSchema();
  seedProducts(catalogArray);
  purgeSessions(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  // Optional bootstrap admin from environment variables (hash only, never a plain password).
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(), hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (email && hash && /^scrypt:/.test(hash)) upsertAdmin(email, hash);
  else if (email || hash) console.warn("ADMIN_EMAIL / ADMIN_PASSWORD_HASH incomplete or invalid — admin login not configured. Run: npm run admin:password");
  refreshCatalog(catalogArray);
}

module.exports = { init, initSchema, getAdminByEmail, upsertAdmin, touchLogin, createSession, getSession, touchSession, deleteSession, purgeSessions,
  audit, listAudit, listProducts, getProduct, insertProduct, updateProduct, refreshCatalog, listOrders, getOrder, updateOrderStatus, summary };
