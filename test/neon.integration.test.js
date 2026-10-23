const { test, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();

const expectedBranch = "br-flat-night-b4dd5j7r";
let db;
let testOrderId;

test("test mode and database URL are explicitly configured", () => {
  assert.equal(process.env.MIGRATION_TEST_MODE, "1");
  assert.ok(process.env.MIGRATION_TEST_DATABASE_URL);
  assert.equal(process.env.DATABASE_URL || "", "");
});

test("Neon branch, schema, and PostgreSQL read/write operations work", async () => {
  db = require("../db/postgres");
  const branch = await db.query("SELECT current_setting('neon.branch_id', true) AS branch_id");
  assert.equal(branch.rows[0].branch_id, expectedBranch);

  const tablesResult = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );
  const tables = new Set(tablesResult.rows.map(r => r.table_name));
  for (const name of ["products", "orders", "admin_users", "admin_sessions", "admin_audit"]) {
    assert.ok(tables.has(name), `Missing table: ${name}`);
  }

  const store = require("../db/admin-store");
  const products = await store.listProducts();
  assert.ok(Array.isArray(products));

  const summary = await store.summary();
  assert.equal(typeof summary.products.total, "number");
  assert.equal(typeof summary.products.active, "number");

  const listed = await store.listOrders({ limit: 5, offset: 0 });
  assert.ok(Array.isArray(listed.rows));

  assert.equal(await store.getAdminByEmail("neon-read-test-nobody@example.invalid"), null);

  const orders = require("../db/database");
  testOrderId = `MIGRATION-TEST-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  const order = {
    id: testOrderId,
    customer_name: "Neon Migration Test",
    email: "neon-test@example.invalid",
    phone: "9999999999",
    items: JSON.stringify([{ id: "migration-test", qty: 1 }]),
    subtotal: 123,
    total: 123,
    currency: "INR",
    status: "pending",
    razorpay_order_id: "rzp_test_migration_" + Date.now(),
    razorpay_payment_id: null,
    created_at: now,
    updated_at: now
  };

  await orders.createOrder(order);
  const found = await orders.getOrder(testOrderId);
  assert.equal(found.id, testOrderId);
  assert.equal(Number(found.total), 123);

  const updated = await orders.updateOrderStatus(testOrderId, "paid", "pay_test_migration");
  assert.equal(updated.status, "paid");
  assert.equal(updated.razorpay_payment_id, "pay_test_migration");

  const byRazorpay = await orders.getOrderByRazorpayId(order.razorpay_order_id);
  assert.equal(byRazorpay.id, testOrderId);

  console.log("PostgreSQL read/write checks passed.");
});

after(async () => {
  try {
    if (db && testOrderId) {
      await db.query("DELETE FROM orders WHERE id=$1", [testOrderId]);
      console.log("Removed only the uniquely identified test order.");
    }
  } finally {
    if (db) await db.close();
  }
});
