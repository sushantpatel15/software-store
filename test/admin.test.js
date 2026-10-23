/**
 * Tests for the admin login + dashboard API. Run: npm test
 * Uses a temp copy of the server with fixture products and a throw-away database.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword, verifyPassword, passwordProblem } = require("../src/password");

const ROOT = path.join(__dirname, "..");
const FIXTURE = `module.exports = [
  { id:"free-tool", name:"Free Tool", category:"A", description:"d", price:0, type:"subscription", allowQty:false, active:true },
  { id:"priced-one", name:"Priced One", category:"B", description:"d", price:1499, type:"one-time", allowQty:true, active:true },
];`;
const EMAIL = "owner@example.com", PASSWORD = "correct horse battery 42";
let tmp, srv, dbFile, noAdmin;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function start(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], { cwd: tmp, env: { PATH: process.env.PATH, PORT: String(port), DB_PATH: dbFile, WHATSAPP_NUMBER: "919876543210", ...env } });
  await new Promise((resolve, reject) => { child.stdout.on("data", (d) => String(d).includes("Store running") && resolve()); child.on("exit", (c) => reject(new Error("exit " + c))); setTimeout(() => reject(new Error("timeout")), 8000); });
  return { child, base: `http://localhost:${port}`, host: `localhost:${port}` };
}
const sql = (q, ...a) => { const db = new DatabaseSync(dbFile); try { return db.prepare(q).all(...a); } finally { db.close(); } };
const run = (q, ...a) => { const db = new DatabaseSync(dbFile); try { return db.prepare(q).run(...a); } finally { db.close(); } };

async function login(email = EMAIL, password = PASSWORD) {
  const r = await fetch(srv.base + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await r.json(); const setCookie = r.headers.get("set-cookie") || "";
  return { r, body, setCookie, cookie: setCookie.split(";")[0] };
}
const call = (s, method, p, { body, cookie, csrf, headers } = {}) => fetch(s.base + "/admin/api" + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-test-")); dbFile = path.join(tmp, "test.db");
  for (const f of ["server.js", "package.json"]) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  for (const d of ["db", "src", "admin-ui"]) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true, filter: (s) => !/\.db(-|$)/.test(s) });
  fs.mkdirSync(path.join(tmp, "data")); fs.writeFileSync(path.join(tmp, "data", "products.js"), FIXTURE);
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(tmp, "node_modules"));
  srv = await start({ ADMIN_EMAIL: EMAIL.toUpperCase(), ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD) });
  noAdmin = await start({ DB_PATH: path.join(tmp, "other.db") });
});
after(() => { srv && srv.child.kill(); noAdmin && noAdmin.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("password hashing: verifies, rejects wrong/tampered/malformed, enforces strength", async () => {
  const h = await hashPassword("a long enough passphrase");
  assert.match(h, /^scrypt:32768:8:1:[\w-]+:[\w-]+$/); assert.ok(!h.includes("$"));
  assert.equal(await verifyPassword("a long enough passphrase", h), true);
  assert.equal(await verifyPassword("a long enough passphrasE", h), false);
  for (const bad of ["", "plain", "scrypt:1:1:1:aa:bb", "scrypt:32768:8:1:x", h.replace(/.$/, "A")]) assert.equal(await verifyPassword("a long enough passphrase", bad), false);
  assert.ok(passwordProblem("short")); assert.ok(passwordProblem("aaaaaaaaaaaaaaaa")); assert.ok(passwordProblem("password1234567")); assert.equal(passwordProblem(PASSWORD, EMAIL), null);
  assert.notEqual(await hashPassword("same"), await hashPassword("same"), "salted");
});

test("nothing in the admin area is reachable without signing in", async () => {
  let r = await fetch(srv.base + "/admin", { redirect: "manual" }); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/admin/login");
  r = await fetch(srv.base + "/admin/orders?token=anything", { redirect: "manual" }); assert.equal(r.status, 302); // old token page retired
  for (const [m, p] of [["GET", "/products"], ["GET", "/orders"], ["GET", "/orders/ORD-20260101-AAAAAA"], ["GET", "/summary"], ["GET", "/audit"], ["GET", "/me"],
    ["POST", "/products"], ["PATCH", "/products/free-tool"], ["PATCH", "/orders/ORD-20260101-AAAAAA"], ["POST", "/logout"]]) {
    r = await call(srv, m, p, { body: m === "GET" ? undefined : {} }); assert.equal(r.status, 401, m + " " + p);
  }
  for (const p of ["/admin/dashboard.html", "/admin-ui/dashboard.html", "/admin/assets/../dashboard.html"]) { r = await fetch(srv.base + p, { redirect: "manual" }); assert.ok([302, 404].includes(r.status), p + " " + r.status); assert.ok(!(await r.text()).includes("Admin dashboard")); }
  const bogus = await call(srv, "GET", "/me", { cookie: "admin_sid=not-a-real-token" }); assert.equal(bogus.status, 401);
});

test("login page is public, has no-store + CSP + anti-framing headers", async () => {
  const r = await fetch(srv.base + "/admin/login"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/); assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-frame-options"), "DENY");
  const html = await r.text(); assert.ok(!/<script>[^<]/.test(html) && !/ on\w+=/.test(html), "no inline scripts or handlers");
});

test("login: wrong password, unknown email and no-admin server all look identical; no default credentials", async () => {
  const a = await login(EMAIL, "wrong password here"), b = await login("nobody@example.com", PASSWORD);
  assert.equal(a.r.status, 401); assert.equal(b.r.status, 401); assert.deepEqual(a.body, b.body); assert.equal(a.body.error, "Invalid email or password.");
  assert.ok(!a.setCookie);
  for (const [e, p] of [["admin@example.com", "admin"], ["admin", "admin123456789"], ["", ""]]) {
    const r = await fetch(noAdmin.base + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }); assert.equal(r.status, 401);
  }
  assert.equal(sql("SELECT COUNT(*) n FROM admin_users")[0].n, 1, "only the env-configured admin exists");
  const bad = await fetch(srv.base + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: { $ne: "" }, password: { $ne: "" } }) }); assert.equal(bad.status, 401);
});

test("login success: secure cookie flags, hashed session storage, no password material in DB", async () => {
  const { r, body, setCookie, cookie } = await login(); // email is case-insensitive
  assert.equal(r.status, 200); assert.equal(body.email, EMAIL); assert.ok(body.csrfToken.length >= 24);
  for (const f of ["HttpOnly", "SameSite=Strict", "Path=/admin", "Max-Age=28800"]) assert.ok(setCookie.includes(f), f);
  const token = cookie.split("=")[1]; const rows = sql("SELECT * FROM admin_sessions");
  assert.ok(rows.length >= 1 && rows.every((x) => x.token_hash !== token && x.token_hash.length === 64), "token stored only as SHA-256");
  assert.ok(!JSON.stringify(sql("SELECT * FROM admin_audit")).includes(PASSWORD));
  assert.ok(!sql("SELECT password_hash FROM admin_users")[0].password_hash.includes(PASSWORD));
  const page = await fetch(srv.base + "/admin", { headers: { Cookie: cookie } }); assert.equal(page.status, 200); assert.match(await page.text(), /Admin dashboard/);
  const me = await (await call(srv, "GET", "/me", { cookie })).json(); assert.equal(me.csrfToken, body.csrfToken);
  const other = await login(); assert.notEqual(other.cookie, cookie, "new session token each login"); assert.notEqual(other.body.csrfToken, body.csrfToken);
});

test("CSRF: changes need the token header and a same-origin request", async () => {
  const { cookie, body } = await login(); const csrf = body.csrfToken; const patch = { price: 1234 };
  assert.equal((await call(srv, "PATCH", "/products/free-tool", { cookie, body: patch })).status, 403, "no token");
  assert.equal((await call(srv, "PATCH", "/products/free-tool", { cookie, csrf: "wrong", body: patch })).status, 403, "wrong token");
  assert.equal((await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: patch, headers: { Origin: "https://evil.example" } })).status, 403, "cross-origin");
  assert.equal((await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: patch, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403, "cross-site fetch");
  assert.equal((await fetch(srv.base + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).status, 403, "login CSRF");
  assert.equal((await call(srv, "GET", "/products", { cookie })).status, 200, "reads need no token");
  assert.equal((await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: { price: 0 }, headers: { Origin: srv.base } })).status, 200, "valid request OK");
});

test("products: price/availability edits reach the storefront immediately and are audited", async () => {
  const { cookie, body: { csrfToken: csrf } } = await login();
  const shop = async () => (await (await fetch(srv.base + "/api/products")).json());
  assert.ok((await shop()).find((p) => p.id === "free-tool" && p.price === 0));
  let r = await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: { price: 799, active: true } }); assert.equal(r.status, 200);
  assert.equal((await shop()).find((p) => p.id === "free-tool").price, 799);
  const enq = (items) => fetch(srv.base + "/api/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Asha Rao", email: "a@example.com", phone: "9876543210", items }) }).then(async (x) => ({ s: x.status, b: await x.json() }));
  let e = await enq([{ id: "free-tool", qty: 1 }]); assert.equal(e.s, 200); assert.ok(e.b.message.includes("₹799") && e.b.message.includes("Subtotal: ₹799"));
  await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: { active: false } });
  assert.ok(!(await shop()).find((p) => p.id === "free-tool"), "hidden from store"); e = await enq([{ id: "free-tool", qty: 1 }]); assert.equal(e.s, 400, "inactive product can't be ordered");
  assert.equal((await (await call(srv, "GET", "/products", { cookie })).json()).find((p) => p.id === "free-tool").active, false, "admin still sees it");
  await call(srv, "PATCH", "/products/free-tool", { cookie, csrf, body: { active: true, price: 0 } });
  const log = sql("SELECT action, target, detail FROM admin_audit WHERE action='product.update' ORDER BY id");
  assert.ok(log.length >= 3 && log.some((l) => l.detail.includes('"price":{"from":0,"to":799}')));
});

test("products: validation, create, duplicate and unknown id", async () => {
  const { cookie, body: { csrfToken: csrf } } = await login(); const P = (b, id = "free-tool") => call(srv, "PATCH", "/products/" + id, { cookie, csrf, body: b });
  for (const bad of [{ price: -1 }, { price: 1.5 }, { price: "100" }, { price: 1e9 }, { price: null }, { name: "x" }, { name: 5 }, { type: "lifetime" }, { active: "yes" }, { period: "decade" }, { description: "x".repeat(501) }])
    assert.equal((await P(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await P({ price: 1 }, "nope")).status, 404);
  const C = (b) => call(srv, "POST", "/products", { cookie, csrf, body: b });
  for (const id of ["Bad Id", "../x", "", "UPPER", "a".repeat(81), 5]) assert.equal((await C({ id, name: "Valid Name", category: "Cat" })).status, 400, String(id));
  assert.equal((await C({ id: "free-tool", name: "Dup", category: "A" })).status, 400, "duplicate id");
  assert.equal((await C({ id: "x-1", category: "A" })).status, 400, "name required");
  const ok = await C({ id: "new-claude-tool", name: "<b>New</b> Tool", category: "Cat", price: 250, type: "one-time", allowQty: true }); assert.equal(ok.status, 201);
  const shop = await (await fetch(srv.base + "/api/products")).json(); const np = shop.find((p) => p.id === "new-claude-tool");
  assert.ok(np && np.price === 250 && np.allowQty === true && np.active === true);
  const unchanged = await P({ price: 0 }); assert.equal(unchanged.status, 200);
});

test("orders: customer order flow still works; admin can search, view and change status (audited)", async () => {
  const create = await fetch(srv.base + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "<img src=x onerror=alert(1)> Buyer", email: "buyer@example.com", phone: "9876543210", items: [{ id: "priced-one", qty: 2 }] }) });
  assert.equal(create.status, 201); const { orderId } = await create.json();
  const pub = await (await fetch(srv.base + "/api/orders/" + orderId)).json(); assert.equal(pub.status, "pending"); assert.equal(pub.total, 2998);
  const { cookie, body: { csrfToken: csrf } } = await login();
  let list = await (await call(srv, "GET", "/orders?q=buyer%40example", { cookie })).json(); assert.equal(list.total, 1); assert.equal(list.orders[0].id, orderId); assert.equal(list.orders[0].itemCount, 2);
  assert.equal((await (await call(srv, "GET", "/orders?q=%25", { cookie })).json()).total, 0, "wildcards are escaped");
  assert.equal((await (await call(srv, "GET", "/orders?q=' OR 1=1 --", { cookie })).json()).total, 0, "SQL injection attempt matches nothing");
  assert.equal((await (await call(srv, "GET", "/orders?status=pending", { cookie })).json()).total, 1);
  const d = await (await call(srv, "GET", "/orders/" + orderId, { cookie })).json(); assert.equal(d.email, "buyer@example.com"); assert.equal(d.items[0].qty, 2);
  assert.equal((await call(srv, "GET", "/orders/not-an-id", { cookie })).status, 404);
  for (const status of ["refunded", "", 5, null, "PAID"]) assert.equal((await call(srv, "PATCH", "/orders/" + orderId, { cookie, csrf, body: { status } })).status, 400, String(status));
  assert.equal((await call(srv, "PATCH", "/orders/" + orderId, { cookie, csrf, body: { status: "cancelled" } })).status, 200);
  assert.equal((await (await fetch(srv.base + "/api/orders/" + orderId)).json()).status, "cancelled");
  assert.ok(sql("SELECT detail FROM admin_audit WHERE action='order.status'")[0].detail.includes('"to":"cancelled"'));
  const sum = await (await call(srv, "GET", "/summary", { cookie })).json(); assert.equal(sum.orders.cancelled, 1);
});

test("logout, idle timeout and absolute expiry end the session", async () => {
  let s = await login(); assert.equal((await call(srv, "POST", "/logout", { cookie: s.cookie, csrf: s.body.csrfToken })).status, 200);
  assert.equal((await call(srv, "GET", "/me", { cookie: s.cookie })).status, 401, "old cookie dead after logout");
  s = await login(); const hash = require("node:crypto").createHash("sha256").update(s.cookie.split("=")[1]).digest("hex");
  run("UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?", new Date(Date.now() - 31 * 60 * 1000).toISOString(), hash);
  assert.equal((await call(srv, "GET", "/me", { cookie: s.cookie })).status, 401, "idle > 30 min");
  s = await login(); const h2 = require("node:crypto").createHash("sha256").update(s.cookie.split("=")[1]).digest("hex");
  run("UPDATE admin_sessions SET expires_at=? WHERE token_hash=?", new Date(Date.now() - 1000).toISOString(), h2);
  assert.equal((await call(srv, "GET", "/me", { cookie: s.cookie })).status, 401, "absolute expiry");
});

test("existing customer & order tables were left alone", () => {
  const cols = sql("PRAGMA table_info(orders)").map((c) => c.name).join();
  assert.equal(cols, "id,customer_name,email,phone,items,subtotal,total,currency,status,razorpay_order_id,razorpay_payment_id,created_at,updated_at");
  const src = fs.readFileSync(path.join(ROOT, "db", "admin-store.js"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/DROP\s|TRUNCATE|DELETE\s+FROM\s+orders|ALTER\s+TABLE\s+orders|UPDATE\s+orders\s+SET\s+(?!status)/i.test(src), "no destructive SQL on orders");
});

test("brute force is throttled per email and per IP (runs last)", async () => {
  let last;
  for (let i = 0; i < 5; i++) last = await login("victim@example.com", "guess number " + i);
  assert.equal(last.r.status, 401);
  const blocked = await login("victim@example.com", "guess number 6"); assert.equal(blocked.r.status, 429); assert.ok(blocked.r.headers.get("retry-after"));
  assert.equal((await login("victim@example.com", PASSWORD)).r.status, 429, "even a correct password is refused while blocked");
  assert.equal((await login()).r.status, 200, "the real admin is not locked out by someone else's email");
});
