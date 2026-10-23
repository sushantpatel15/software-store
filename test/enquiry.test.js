/**
 * Tests for the WhatsApp order-enquiry API.  Run:  npm test
 * Each test run copies the server into a temp folder with FIXTURE products
 * (priced, price-on-request, inactive, allowQty) and a throw-away database,
 * so your real data/products.js and db/store.db are never touched.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const FIXTURE = `module.exports = [
  { id:"free-tool", name:"Free Tool", category:"A", description:"d", price:0, type:"subscription", allowQty:false, active:true },
  { id:"qty-tool", name:"Qty Tool", category:"A", description:"d", price:0, type:"one-time", allowQty:true, active:true },
  { id:"priced-one", name:"Priced One", category:"A", description:"d", price:1499, type:"one-time", allowQty:true, active:true },
  { id:"priced-two", name:"Priced Two", category:"A", description:"d", price:500, type:"subscription", allowQty:false, active:true },
  { id:"retired", name:"Retired", category:"A", description:"d", price:100, type:"subscription", allowQty:false, active:false },
];`;

let tmp, ok, noWa, placeholderWa;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: tmp, env: { PATH: process.env.PATH, DB_PATH: path.join(tmp, "db", "store.db"), PORT: String(port), BUSINESS_NAME: "Test Store", SUPPORT_EMAIL: "help@test.example", ...env },
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => String(d).includes("Store running") && resolve());
    child.on("exit", (c) => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server start timeout")), 8000);
  });
  return { child, base: `http://localhost:${port}` };
}
const post = (srv, body, raw) => fetch(srv.base + "/api/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body) });
const customer = { name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210" };
const send = async (srv, extra) => { const r = await post(srv, { ...customer, ...extra }); return { status: r.status, body: await r.json() }; };

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  for (const f of ["server.js", "package.json"]) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  fs.cpSync(path.join(ROOT, "db"), path.join(tmp, "db"), { recursive: true, filter: (s) => !s.endsWith(".db") && !s.includes(".db-") });
  fs.mkdirSync(path.join(tmp, "data")); fs.writeFileSync(path.join(tmp, "data", "products.js"), FIXTURE);
  for (const d of ["src", "admin-ui"]) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(tmp, "node_modules"));
  ok = await startServer({ WHATSAPP_NUMBER: "+91 98765-43210" });
  noWa = await startServer({ WHATSAPP_NUMBER: "" });
  placeholderWa = await startServer({ WHATSAPP_NUMBER: "919999999999" });
});
after(() => { for (const s of [ok, noWa, placeholderWa]) s && s.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("price-on-request product is accepted and message says so (no misleading total)", async () => {
  const { status, body } = await send(ok, { items: [{ id: "free-tool", qty: 1 }, { id: "priced-one", qty: 2 }] });
  assert.equal(status, 200);
  assert.match(body.reference, /^ENQ-\d{8}-[0-9A-F]{6}$/);
  for (const s of ["Test Store", body.reference, "Name: Asha Rao", "Email: asha@example.com", "Phone: +91 98765 43210",
    "1. Free Tool × 1 — Price on request", "2. Priced One × 2 — ₹1,499 each = ₹2,998", "Final quotation required",
    "confirm availability, the final quote and the next steps"]) assert.ok(body.message.includes(s), "missing: " + s);
  assert.ok(!/Subtotal/.test(body.message), "must not show a subtotal when a price is unknown");
  assert.equal(body.quotationRequired, true);
});

test("all-priced cart shows an accurate subtotal", async () => {
  const { body } = await send(ok, { items: [{ id: "priced-one", qty: 2 }, { id: "priced-two", qty: 1 }] });
  assert.ok(body.message.includes("Subtotal: ₹3,498"));
  assert.ok(!body.message.includes("Final quotation required"));
  assert.equal(body.quotationRequired, false);
});

test("WhatsApp URL: digits-only number, fully encoded message", async () => {
  const { body } = await send(ok, { items: [{ id: "free-tool", qty: 1 }], notes: "Need it & fast #1 100%" });
  assert.ok(body.whatsappUrl.startsWith("https://wa.me/919876543210?text="));
  const text = body.whatsappUrl.split("?text=")[1];
  assert.ok(!/[\s\n&#]/.test(text.replace(/%[0-9A-F]{2}/g, "")), "raw reserved chars must be encoded");
  assert.equal(decodeURIComponent(text), body.message);
});

test("browser-supplied prices are ignored", async () => {
  const { body } = await send(ok, { items: [{ id: "priced-one", qty: 1, price: 1, total: 1 }], price: 1 });
  assert.ok(body.message.includes("₹1,499 each"));
  assert.ok(!body.message.includes("₹1 "));
});

test("optional requirements are included; control characters are stripped", async () => {
  const { body } = await send(ok, { items: [{ id: "free-tool", qty: 1 }], plan: "Pro\u0000", duration: "12 months", warranty: "fw", notes: "line1\nline2" });
  for (const s of ["Plan: Pro", "Duration: 12 months", "Warranty preference: Full Warranty (FW)", "Notes: line1\nline2"]) assert.ok(body.message.includes(s), s);
  assert.ok(!body.message.includes("\u0000"));
});

test("customer field validation returns field errors", async () => {
  const items = [{ id: "free-tool", qty: 1 }];
  let r = await send(ok, { items, name: "A" }); assert.equal(r.status, 400); assert.ok(r.body.fields.name);
  r = await send(ok, { items, email: "not-an-email" }); assert.equal(r.status, 400); assert.ok(r.body.fields.email);
  r = await send(ok, { items, phone: "12345" }); assert.ok(r.body.fields.phone);
  r = await send(ok, { items, phone: "abcdefghij" }); assert.ok(r.body.fields.phone);
  r = await send(ok, { items, warranty: "LIFETIME" }); assert.ok(r.body.fields.warranty);
  r = await send(ok, { items, name: { $ne: 1 } }); assert.ok(r.body.fields.name);
});

test("bad carts are rejected", async () => {
  const bad = {
    "empty cart": [], "not an array": "free-tool", "missing": undefined,
    "unknown id": [{ id: "nope", qty: 1 }], "path-like id": [{ id: "../etc/passwd", qty: 1 }], "uppercase/odd id": [{ id: "FREE TOOL", qty: 1 }],
    "numeric id": [{ id: 5, qty: 1 }], "null line": [null], "object id": [{ id: { a: 1 }, qty: 1 }],
    "inactive product": [{ id: "retired", qty: 1 }],
    "qty 0": [{ id: "priced-one", qty: 0 }], "qty negative": [{ id: "priced-one", qty: -1 }], "qty too big": [{ id: "priced-one", qty: 11 }],
    "qty fractional": [{ id: "priced-one", qty: 1.5 }], "qty string": [{ id: "priced-one", qty: "2" }], "qty missing": [{ id: "priced-one" }],
    "qty NaN-like": [{ id: "priced-one", qty: null }],
    "qty 2 where not allowed": [{ id: "free-tool", qty: 2 }],
    "duplicate lines": [{ id: "free-tool", qty: 1 }, { id: "free-tool", qty: 1 }],
    "too many lines": Array.from({ length: 21 }, () => ({ id: "free-tool", qty: 1 })),
  };
  for (const [label, items] of Object.entries(bad)) {
    const r = await send(ok, { items });
    assert.equal(r.status, 400, label); assert.ok(r.body.error, label); assert.equal(r.body.whatsappUrl, undefined, label);
  }
  // quantity above 1 IS fine where allowed, including for a price-on-request product
  const good = await send(ok, { items: [{ id: "qty-tool", qty: 3 }] });
  assert.equal(good.status, 200); assert.ok(good.body.message.includes("Qty Tool × 3 — Price on request"));
});

test("malformed JSON gets a clean JSON error", async () => {
  const r = await post(ok, null, "{bad json");
  assert.equal(r.status, 400); assert.ok((await r.json()).error);
});

test("missing or placeholder WhatsApp number gives a helpful error, never a broken link", async () => {
  for (const srv of [noWa, placeholderWa]) {
    const r = await send(srv, { items: [{ id: "free-tool", qty: 1 }] });
    assert.equal(r.status, 503); assert.match(r.body.error, /help@test\.example/); assert.equal(r.body.whatsappUrl, undefined);
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.whatsappReady, false); assert.equal(cfg.whatsappNumber, null);
  }
  const cfg = await (await fetch(ok.base + "/api/config")).json();
  assert.equal(cfg.whatsappReady, true); assert.equal(cfg.whatsappNumber, "919876543210");
});

test("inactive products are hidden from the catalog; price-on-request ones are listed", async () => {
  const list = await (await fetch(ok.base + "/api/products")).json();
  assert.ok(!list.find((p) => p.id === "retired")); assert.ok(list.find((p) => p.id === "free-tool" && p.price === 0));
});

test("enquiry does not create orders or payments", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(tmp, "db", "store.db"));
  const n = () => db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
  const before = n();
  await send(ok, { items: [{ id: "priced-one", qty: 1 }] });
  assert.equal(n(), before); assert.equal(n(), 0);
  db.close();
  // static check: the handler never touches Razorpay, the database, or logging
  const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const handler = src.slice(src.indexOf('app.post("/api/enquiries"'), src.indexOf("// Create a pending order"));
  assert.ok(handler.length > 500);
  assert.ok(!/razorpay|store\.|updateOrderStatus|paid|console\./i.test(handler), "enquiry handler must not use payments, DB or logging");
});
