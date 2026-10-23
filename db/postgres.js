const { Pool } = require("pg");

const migrationTestMode = process.env.MIGRATION_TEST_MODE === "1";
const migrationTestUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const expectedBranchId = "br-flat-night-b4dd5j7r";

if (migrationTestUrl && !migrationTestMode) {
  throw new Error("MIGRATION_TEST_DATABASE_URL requires MIGRATION_TEST_MODE=1.");
}
if (migrationTestMode && !migrationTestUrl) {
  throw new Error("MIGRATION_TEST_MODE=1 requires MIGRATION_TEST_DATABASE_URL.");
}

const connectionString = migrationTestMode ? migrationTestUrl : process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(migrationTestMode ? "MIGRATION_TEST_DATABASE_URL is required." : "DATABASE_URL is required.");
}

// Keep the pool private so callers cannot bypass verifyBranch().
const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
let verifiedTestBranch = false;

async function verifyBranch() {
  if (!migrationTestMode || verifiedTestBranch) return;

  const result = await pool.query(
    "SELECT current_setting('neon.branch_id', true) AS branch_id"
  );
  if (result.rows[0]?.branch_id !== expectedBranchId) {
    throw new Error("Database branch verification failed. Query blocked.");
  }
  verifiedTestBranch = true;
}

async function query(text, params = []) {
  await verifyBranch();
  return pool.query(text, params);
}

async function exec(text) {
  await query(text);
}

async function close() {
  await pool.end();
}

module.exports = { query, exec, close };
