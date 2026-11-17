import { readdirSync, readFileSync } from "fs";
import { adminDb } from "./db-admin";

const sql = adminDb();
const dir = "supabase/migrations";

await sql`create schema if not exists ops`;
await sql`create table if not exists ops.schema_migrations (filename text primary key, applied_at timestamptz default now())`;
const done = new Set((await sql`select filename from ops.schema_migrations`).map((r) => r.filename));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) { console.log(`skip  ${file}`); continue; }
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(`${dir}/${file}`, "utf8"));
    await tx`insert into ops.schema_migrations (filename) values (${file})`;
  });
  console.log(`apply ${file}`);
}
await sql.end();
