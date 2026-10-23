#!/usr/bin/env node
/**
 * Creates the hash for your admin password. The plain password is never written anywhere.
 *   npm run admin:password           -> prints ADMIN_EMAIL / ADMIN_PASSWORD_HASH to paste into .env or Render
 *   npm run admin:password -- --save -> also saves the admin straight into the LOCAL database
 */
const readline = require("readline");
const { hashPassword, passwordProblem } = require("../src/password");

function ask(question, hidden) {
  return new Promise((resolve) => {
    if (!hidden) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(question, (a) => { rl.close(); resolve(a); }); return; }
    process.stdout.write(question); let value = "";
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\u0003") { process.stdout.write("\n"); process.exit(1); }
        if (c === "\r" || c === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener("data", onData); process.stdout.write("\n"); return resolve(value); }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1); else value += c;
      }
    };
    process.stdin.on("data", onData);
  });
}
(async () => {
  if (!process.stdin.isTTY) { console.error("Run this in a terminal (it needs to hide your typing)."); process.exit(1); }
  const email = (await ask("Admin email: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("That doesn't look like a valid email."); process.exit(1); }
  const pw = await ask("Password (min 12 characters): ", true);
  const problem = passwordProblem(pw, email);
  if (problem) { console.error(problem); process.exit(1); }
  if (pw !== (await ask("Repeat password: ", true))) { console.error("Passwords do not match."); process.exit(1); }
  const hash = await hashPassword(pw);
  if (process.argv.includes("--save")) {
    require("dotenv").config();
    const s = require("../db/admin-store"); s.initSchema(); console.log(`\nSaved to local database (${s.upsertAdmin(email, hash)}).`);
  }
  console.log("\nAdd these two lines to your .env (and to Render → Environment):\n");
  console.log(`ADMIN_EMAIL=${email}`);
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
  console.log("They contain no plain password. Do not commit the .env file.");
})();
