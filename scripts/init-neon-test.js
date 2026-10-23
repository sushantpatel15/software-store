require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const connectionString = process.env.MIGRATION_TEST_DATABASE_URL;

if (!connectionString) {
  console.error("MIGRATION_TEST_DATABASE_URL is missing. No changes made.");
  process.exit(1);
}


(async () => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000
  });

  try {
    await client.connect();

    const branch = await client.query(
      "SELECT current_setting('neon.branch_id', true) AS branch_id"
    );
    const branchId = branch.rows[0].branch_id;

    if (branchId !== "br-flat-night-b4dd5j7r") {
      throw new Error(
        `Safety check failed: expected test branch br-flat-night-b4dd5j7r, got ${branchId || "unknown"}. No schema applied.`
      );
    }

    console.log("Verified migration-test branch:", branchId);

    const identity = await client.query(
      "SELECT current_database() AS db, current_user AS role, inet_server_addr()::text AS server"
    );
    console.log("Connected to database:", identity.rows[0].db);
    console.log("Database role:", identity.rows[0].role);
    console.log("Applying CREATE TABLE IF NOT EXISTS schema to the test branch only...");

    const schema = fs.readFileSync(
      path.join(__dirname, "..", "db", "postgres-schema.sql"),
      "utf8"
    );

    await client.query("BEGIN");
    try {
      await client.query(schema);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );

    console.log("Schema initialized. Tables:", tables.rows.map((r) => r.tablename).join(", "));
  } catch (err) {
    console.error("Schema initialization failed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
