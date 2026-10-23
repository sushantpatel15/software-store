
require("dotenv").config();

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const { Pool } = require("pg");

const EXPECTED_BRANCH_ID = "br-flat-night-b4dd5j7r";

async function main() {
  const url = process.env.MIGRATION_TEST_DATABASE_URL;

  if (process.env.DATABASE_URL) {
    throw new Error("Safety stop: DATABASE_URL is set. Refusing to import.");
  }

  if (!url) {
    throw new Error("MIGRATION_TEST_DATABASE_URL is missing.");
  }

  const sqlite = new DatabaseSync(
    path.join(__dirname, "../db/store.db"),
    { readOnly: true }
  );

  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    const branch = await pool.query(
      "SELECT current_setting('neon.branch_id', true) AS id"
    );

    if (branch.rows[0]?.id !== EXPECTED_BRANCH_ID) {
      throw new Error("Safety stop: Neon branch ID does not match.");
    }

    const tables = [
      "orders",
      "admin_users",
      "admin_sessions",
      "admin_audit",
      "products"
    ];

    for (const table of tables) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`
      );

      if (result.rows[0].count !== 0) {
        throw new Error(
          `Safety stop: Neon table ${table} is not empty.`
        );
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const table of tables) {
        const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();

        for (const row of rows) {
          const columns = Object.keys(row);
          const values = columns.map((column) => row[column]);
          const placeholders = columns.map((_, i) => `$${i + 1}`);

          const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders.join(",")})`;

          await client.query(sql, values);
        }

        const target = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${table}"`
        );

        if (target.rows[0].count !== rows.length) {
          throw new Error(`Row-count mismatch for ${table}.`);
        }

        console.log(`${table}: ${rows.length} rows imported and verified`);
      }

      await client.query("COMMIT");
      console.log("Import completed successfully.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Import stopped:", error.message);
  process.exitCode = 1;
});
