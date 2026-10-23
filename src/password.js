/**
 * Password hashing with scrypt (built into Node, no extra packages).
 * Stored format:  scrypt:N:r:p:salt:hash   (salt/hash are base64url, so no "$" characters)
 * The parameters are stored with the hash so they can be strengthened later without breaking old hashes.
 */
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

/** Returns true/false. Never throws; malformed hashes simply fail. Comparison is constant-time. */
async function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split(":");
    const n = Number(N), rr = Number(r), pp = Number(p);
    if (alg !== "scrypt" || !salt || !hash) return false;
    if (!(n >= 2 ** 14 && n <= 2 ** 17 && (n & (n - 1)) === 0) || !(rr >= 1 && rr <= 16) || !(pp >= 1 && pp <= 4)) return false;
    const expected = Buffer.from(hash, "base64url");
    const key = await scrypt(String(password), Buffer.from(salt, "base64url"), expected.length, { N: n, r: rr, p: pp, maxmem: MAXMEM });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

// A real hash of a random value. Used so a login for an unknown email takes as long as a real one.
let dummy;
const dummyHash = () => (dummy ||= hashPassword(crypto.randomBytes(24).toString("hex")));

const COMMON = ["password1234", "123456789012", "qwertyuiop12", "administrator", "letmein12345", "welcome12345"];
/** Returns an error message, or null if the password is acceptable. */
function passwordProblem(password, email = "") {
  if (typeof password !== "string" || password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (new Set(password).size < 5) return "Password is too repetitive.";
  const lower = password.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) return "Password is too common.";
  if (email && lower.includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Password must not contain your email name.";
  return null;
}

module.exports = { hashPassword, verifyPassword, dummyHash, passwordProblem };
