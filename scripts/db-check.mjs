// scripts/db-check.mjs
import { Client } from "pg";

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase/Neon では基本必要
});

try {
  await client.connect();
  const r = await client.query("select now() as now_utc, current_user, version()");
  console.log("✅ DB接続OK:", r.rows[0]);
} catch (e) {
  console.error("❌ DB接続失敗:", e);
} finally {
  await client.end();
}
