/**
 * Admin sessions, cookies, CSRF protection and login throttling.
 *
 * Design:
 *  - Random 256-bit session token in an HttpOnly + SameSite=Strict cookie (Secure in production).
 *  - Only the SHA-256 of the token is stored server-side, so a database leak does not leak live sessions.
 *  - Sessions expire after 30 min of inactivity or 8 hours total.
 *  - Every state-changing request needs the per-session CSRF token header AND a same-origin Origin header.
 *  - Failed logins are throttled per email and per IP (in memory; resets on restart).
 */
const crypto = require("crypto");
const store = require("../db/admin-store");

const COOKIE = "admin_sid";
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const isProd = () => process.env.NODE_ENV === "production";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}
const cookieFlags = (req) => `Path=/admin; HttpOnly; SameSite=Strict${isProd() || req.secure ? "; Secure" : ""}`;

function startSession(req, res, admin) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(24).toString("base64url");
  store.createSession({ tokenHash: sha256(token), adminId: admin.id, csrf, expiresAt: new Date(Date.now() + ABSOLUTE_MS).toISOString(), ip: req.ip, userAgent: req.get("user-agent") });
  res.append("Set-Cookie", `${COOKIE}=${token}; ${cookieFlags(req)}; Max-Age=${ABSOLUTE_MS / 1000}`);
  return csrf;
}
function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) store.deleteSession(sha256(token));
  res.append("Set-Cookie", `${COOKIE}=; ${cookieFlags(req)}; Max-Age=0`);
}
/** Returns {id, email, csrf, tokenHash} for a valid, unexpired session, else null. */
function currentSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(token);
  const s = store.getSession(tokenHash);
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) < now || Date.parse(s.last_seen_at) < now - IDLE_MS) { store.deleteSession(tokenHash); return null; }
  if (Date.parse(s.last_seen_at) < now - 60 * 1000) store.touchSession(tokenHash); // refresh at most once a minute
  return { id: s.admin_id, email: s.email, csrf: s.csrf_token, tokenHash };
}

// ---- middleware ----
function requireSession(req, res, next) {
  const s = currentSession(req);
  if (!s) return res.status(401).json({ error: "Please sign in." });
  req.admin = s; next();
}
function requireSessionPage(req, res, next) {
  const s = currentSession(req);
  if (!s) return res.redirect("/admin/login");
  req.admin = s; next();
}
/** Same-origin + CSRF-token check for anything that changes data. */
function sameOrigin(req) {
  const origin = req.get("origin");
  if (origin) { try { return new URL(origin).host === req.get("host"); } catch { return false; } }
  return req.get("sec-fetch-site") !== "cross-site";
}
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!sameOrigin(req) || !safeEqual(req.get("x-csrf-token") || "", req.admin.csrf)) return res.status(403).json({ error: "Request blocked (security check failed). Please reload the page." });
  next();
}
function securityHeaders(req, res, next) {
  res.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (isProd()) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

// ---- login throttling ----
class Throttle {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  _recent(key) { const cut = Date.now() - this.windowMs; const a = (this.hits.get(key) || []).filter((t) => t > cut); a.length ? this.hits.set(key, a) : this.hits.delete(key); return a; }
  blocked(key) { return this._recent(key).length >= this.max; }
  retryAfterSec(key) { const a = this._recent(key); return a.length ? Math.max(1, Math.ceil((a[0] + this.windowMs - Date.now()) / 1000)) : 0; }
  fail(key) { if (this.hits.size > 10000) this.hits.clear(); const a = this._recent(key); a.push(Date.now()); this.hits.set(key, a); }
  reset(key) { this.hits.delete(key); }
}
const emailThrottle = new Throttle(5, 15 * 60 * 1000);   // 5 wrong passwords per email per 15 min
const ipThrottle = new Throttle(20, 15 * 60 * 1000);     // 20 wrong passwords per IP per 15 min

module.exports = { startSession, endSession, currentSession, requireSession, requireSessionPage, requireCsrf, securityHeaders, emailThrottle, ipThrottle, sameOrigin };
