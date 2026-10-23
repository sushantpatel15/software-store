const sqliteMode = process.env.MIGRATION_TEST_MODE !== "1" && !process.env.DATABASE_URL;
let db;
if (sqliteMode) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); } catch { throw new Error("node:sqlite not found. Please use Node.js 22 or newer."); }
  const path = require("path");
const sqlite = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, "store.db"));
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, items TEXT NOT NULL, subtotal INTEGER NOT NULL, total INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'pending', razorpay_order_id TEXT, razorpay_payment_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  db = { async query(text, params=[]) { const values=[]; const sql=text.replace(/\$(\d+)/g,(_m,n)=>{values.push(params[Number(n)-1]);return "?";}); if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)){const rows=sqlite.prepare(sql).all(...values);return{rows,rowCount:rows.length};} const result=sqlite.prepare(sql).run(...values);return{rows:[],rowCount:result.changes}; }, async exec(text){sqlite.exec(text);} };
} else {
  db = require("./postgres");
}
async function createOrder(o) { await db.query(`INSERT INTO orders (id,customer_name,email,phone,items,subtotal,total,currency,status,razorpay_order_id,razorpay_payment_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[o.id,o.customer_name,o.email,o.phone,o.items,o.subtotal,o.total,o.currency,o.status,o.razorpay_order_id||null,o.razorpay_payment_id||null,o.created_at,o.updated_at]);return o; }
async function getOrder(id){const{rows}=await db.query("SELECT * FROM orders WHERE id=$1",[id]);return rows[0]||null;}
async function getOrderByRazorpayId(id){const{rows}=await db.query("SELECT * FROM orders WHERE razorpay_order_id=$1",[id]);return rows[0]||null;}
async function updateOrderStatus(id,status,paymentId=null){const now=new Date().toISOString();if(paymentId)await db.query("UPDATE orders SET status=$1,razorpay_payment_id=$2,updated_at=$3 WHERE id=$4",[status,paymentId,now,id]);else await db.query("UPDATE orders SET status=$1,updated_at=$2 WHERE id=$3",[status,now,id]);return getOrder(id);}
async function listOrders(limit=100){return(await db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT $1",[limit])).rows;}
module.exports={db,sqliteMode,createOrder,getOrder,getOrderByRazorpayId,updateOrderStatus,listOrders};
