import postgres from "postgres";
import { loadSemantic } from "../lib/semantic";

const s = loadSemantic();
const db = postgres(process.env.DATABASE_URL_READER!, { prepare: false, onnotice: () => {} });
let failures = 0;
const report = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

console.log("== 1. Declared columns vs database ==");
const dbCols = await db`select table_schema || '.' || table_name as view, column_name, data_type from information_schema.columns where table_schema = 'clean'`;
const typeOf = (pg: string) => (["integer", "bigint"].includes(pg) ? "integer" : pg === "ARRAY" ? "text[]" : pg);
const declaredTypes = new Map<string, string>();
for (const d of s.layer.dimensions) for (const v of d.views) declaredTypes.set(`${v}.${d.column}`, d.type);
for (const [view, cols] of s.columnsByView) {
  const actual = new Map(dbCols.filter((c) => c.view === view).map((c) => [c.column_name, typeOf(c.data_type)]));
  const missing = [...cols].filter((c) => !actual.has(c));
  const wrongType = [...cols].filter((c) => declaredTypes.has(`${view}.${c}`) && actual.has(c) && declaredTypes.get(`${view}.${c}`) !== actual.get(c))
    .map((c) => `${c} (YAML ${declaredTypes.get(`${view}.${c}`)}, DB ${actual.get(c)})`);
  const nonNumericMetrics = s.layer.metrics.filter((m) => m.columns[view] && !["integer", "numeric"].includes(actual.get(m.columns[view]) ?? "")).map((m) => m.id);
  report(missing.length === 0, `${view}: all ${cols.size} declared columns exist${missing.length ? ` — missing: ${missing}` : ""}`);
  report(wrongType.length === 0 && nonNumericMetrics.length === 0, `${view}: types match${wrongType.length || nonNumericMetrics.length ? ` — ${[...wrongType, ...nonNumericMetrics]}` : ""}`);
  const undeclared = [...actual.keys()].filter((c) => !cols.has(c));
  if (undeclared.length) console.log(`     not shown to the LLM (by design): ${undeclared.join(", ")}`);
}

console.log("\n== 2. Each view has one row per combination of its entity keys ==");
for (const [view, keys] of s.viewKeys) {
  const [r] = await db.unsafe(`select count(*) - count(distinct (${keys.join(", ")})) as dupes from ${view}`);
  report(Number(r.dupes) === 0, `${view} (${keys.join(", ")}): ${r.dupes} duplicates`);
}

console.log("\n== 3. Example queries run as the read-only user ==");
for (const q of s.layer.example_queries) {
  try {
    const rows = await db.unsafe(q.sql);
    report(rows.length > 0, `${q.id}: "${q.question}" -> ${rows.length} row(s)`);
    console.table(rows.slice(0, 5));
  } catch (e: any) { report(false, `${q.id}: ${e.message}`); }
}

console.log("\n== 4. Seeds (read by the app) match the database ==");
const dbUnis = await db`select university_id, canonical_name, valid_from_year, valid_to_year from clean.dim_university`;
const dbSubs = await db`select subject_id, name, first_year, last_year from clean.dim_subject`;
const seedU = new Set(s.universities.map((u) => `${u.id}|${u.canonical_name}|${u.valid_from_year}|${u.valid_to_year}`));
const seedS = new Set(s.subjects.map((x) => `${x.id}|${x.name}|${x.first_year}|${x.last_year}`));
const diffU = dbUnis.filter((u) => !seedU.has(`${u.university_id}|${u.canonical_name}|${u.valid_from_year}|${u.valid_to_year}`));
const diffS = dbSubs.filter((x) => !seedS.has(`${x.subject_id}|${x.name}|${x.first_year}|${x.last_year}`));
report(diffU.length === 0 && dbUnis.length === s.universities.length, `universities: ${dbUnis.length} in DB, ${s.universities.length} in seed, ${diffU.length} differ (re-run import if not 0)`);
report(diffS.length === 0 && dbSubs.length === s.subjects.length, `subjects: ${dbSubs.length} in DB, ${s.subjects.length} in seed, ${diffS.length} differ (re-run import if not 0)`);

console.log("\n== Summary for review ==");
console.log(`metrics: ${s.layer.metrics.length}, needing review: ${s.layer.metrics.filter((m) => m.needs_review).map((m) => m.id).join(", ")}`);
for (const g of s.kg.groups) console.log(`group ${g.name}: ${g.members.length} members`);

console.log(`\n${failures === 0 ? "ALL SEMANTIC CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await db.end();
process.exit(failures ? 1 : 0);
