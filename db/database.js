/**
 * SQLite setup using Node's built-in node:sqlite (Node 22+).
 * Why built-in? No native package to compile — `npm install` stays simple.
 * DB file is auto-created at db/store.db on first run.
 * We NEVER store card numbers, UPI PINs, or payment credentials here.
 */
const path = require("path");
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); }
catch { throw new Error("node:sqlite not found. Please use Node.js 22 or newer (check: node --version)."); }

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, "store.db")) // set DB_PATH to a persistent disk path on Render;
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
    items TEXT NOT NULL, subtotal INTEGER NOT NULL, total INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'pending',
    razorpay_order_id TEXT, razorpay_payment_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);

function createOrder(o) {
  db.prepare(`INSERT INTO orders (id,customer_name,email,phone,items,subtotal,total,currency,status,razorpay_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.id, o.customer_name, o.email, o.phone, o.items, o.subtotal, o.total, o.currency, o.status, o.razorpay_order_id, o.created_at, o.updated_at);
  return o;
}
const getOrder = (id) => db.prepare("SELECT * FROM orders WHERE id=?").get(id);
const getOrderByRazorpayId = (rid) => db.prepare("SELECT * FROM orders WHERE razorpay_order_id=?").get(rid);
function updateOrderStatus(id, status, paymentId = null) {
  const now = new Date().toISOString();
  if (paymentId) db.prepare("UPDATE orders SET status=?, razorpay_payment_id=?, updated_at=? WHERE id=?").run(status, paymentId, now, id);
  else db.prepare("UPDATE orders SET status=?, updated_at=? WHERE id=?").run(status, now, id);
  return getOrder(id);
}
const listOrders = (limit = 100) => db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?").all(limit);
module.exports = { db, createOrder, getOrder, getOrderByRazorpayId, updateOrderStatus, listOrders };
