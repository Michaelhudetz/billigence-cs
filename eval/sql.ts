import { runQuery, closeDb } from "../lib/db";

const res = await runQuery(process.argv[2] ?? "");
console.log(res.ok ? JSON.stringify(res.rows, null, 1) : `ERROR: ${res.error}`);
await closeDb();
