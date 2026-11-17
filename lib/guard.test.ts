import { describe, expect, test } from "bun:test";
import { guardSql, MAX_ROWS } from "./guard";
import { loadSemantic } from "./semantic";

const rejects: [string, string, string][] = [
  ["DROP", "DROP TABLE clean.overall_ranking", "only select"],
  ["UPDATE", "UPDATE clean.overall_ranking SET rank = 1", "only select"],
  ["DELETE", "DELETE FROM clean.overall_ranking", "only select"],
  ["INSERT", "INSERT INTO ops.query_log (question) VALUES ('x')", "only select"],
  ["chained DELETE", "SELECT rank FROM clean.overall_ranking; DELETE FROM clean.overall_ranking", "multiple statements"],
  ["raw schema", "SELECT * FROM raw.overall", "raw.overall is not allowed"],
  ["raw via UNION", "SELECT university_name FROM clean.overall_ranking UNION SELECT institution FROM raw.overall", "raw.overall"],
  ["raw via subquery", "SELECT * FROM clean.overall_ranking WHERE rank IN (SELECT ranking FROM raw.overall)", "raw.overall"],
  ["raw via CTE", "WITH x AS (SELECT * FROM raw.subject) SELECT * FROM x", "raw.subject"],
  ["ops schema", "SELECT * FROM ops.query_log", "ops.query_log is not allowed"],
  ["pg_sleep", "SELECT pg_sleep(10)", "pg_sleep"],
  ["pg_sleep hidden in WHERE", "SELECT rank FROM clean.overall_ranking WHERE pg_sleep(10) IS NULL", "pg_sleep"],
  ["information_schema", "SELECT * FROM information_schema.tables", "information_schema.tables"],
  ["pg_catalog", "SELECT * FROM pg_catalog.pg_roles", "pg_catalog.pg_roles"],
  ["unqualified table", "SELECT * FROM pg_user", "unknown table"],
  ["line comment trick", "SELECT rank FROM clean.overall_ranking -- ; DROP TABLE x", "comments"],
  ["block comment trick", "SELECT rank FROM clean.overall_ranking /* */ WHERE 1=1", "comments"],
  ["set_config", "SELECT set_config('statement_timeout', '0', false)", "set_config"],
  ["SELECT INTO", "SELECT * INTO public.copy FROM clean.overall_ranking", "into"],
  ["FOR UPDATE (parser cannot read it: rejected, fail closed)", "SELECT rank FROM clean.overall_ranking FOR UPDATE", "could not parse"],
  ["hallucinated column", "SELECT nightlife_score FROM clean.overall_ranking", "unknown column nightlife_score"],
  ["hidden column", "SELECT source_row FROM clean.overall_ranking", "unknown column source_row"],
  ["garbage", "please drop everything", "could not parse"],
  ["empty", "   ", "empty"],
];

describe("guard rejects", () => {
  for (const [name, sql, why] of rejects) {
    test(name, () => {
      const r = guardSql(sql);
      expect(r.ok).toBe(false);
      expect(r.reasons.join(" | ").toLowerCase()).toContain(why);
    });
  }
});

describe("guard accepts and limits", () => {
  for (const q of loadSemantic().layer.example_queries) {
    test(`example query: ${q.id}`, () => {
      const r = guardSql(q.sql);
      expect(r.reasons).toEqual([`added LIMIT ${MAX_ROWS}`]);
      expect(r.ok).toBe(true);
      expect(r.sql.endsWith(`LIMIT ${MAX_ROWS}`)).toBe(true);
    });
  }
  test("caps a large LIMIT", () => {
    const r = guardSql("SELECT university_name FROM clean.overall_ranking ORDER BY rank LIMIT 1000");
    expect(r.ok).toBe(true);
    expect(r.sql).toContain(`LIMIT ${MAX_ROWS}`);
    expect(r.sql).not.toContain("1000");
  });
  test("keeps a small LIMIT", () => {
    const r = guardSql("SELECT university_name FROM clean.overall_ranking ORDER BY rank LIMIT 5;");
    expect(r.ok).toBe(true);
    expect(r.sql).toMatch(/LIMIT 5$/);
  });
  test("caps only the outer LIMIT when a CTE has its own", () => {
    const r = guardSql("WITH t AS (SELECT university_name, rank FROM clean.overall_ranking LIMIT 10) SELECT * FROM t LIMIT 500");
    expect(r.ok).toBe(true);
    expect(r.sql).toContain("LIMIT 10)");
    expect(r.sql).toMatch(/LIMIT 50$/);
  });
});
