import { adminDb } from "./db-admin";

const sql = adminDb();
console.table(await sql`
  select outcome, count(*)::int as questions, round(avg(latency_ms))::int as avg_ms, round(sum(cost_usd)::numeric, 4) as total_usd
  from ops.query_log group by 1 order by 2 desc`);
await sql.end();
