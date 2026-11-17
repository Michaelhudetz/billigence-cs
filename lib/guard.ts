import pkg from "node-sql-parser";
import { loadSemantic } from "./semantic";

const { Parser } = pkg as unknown as { Parser: new () => { astify: (sql: string, opt: object) => unknown; tableList: (sql: string, opt: object) => string[] } };
const parser = new Parser();
const PG = { database: "PostgresQL" };

export const MAX_ROWS = 50;

const ALLOWED_FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max",
  "rank", "dense_rank", "row_number", "lag", "lead",
  "round", "coalesce", "lower", "abs", "nullif",
]);

export type GuardResult = { ok: boolean; sql: string; reasons: string[] };

export function guardSql(input: string): GuardResult {
  const reasons: string[] = [];
  const reject = (r: string): GuardResult => ({ ok: false, sql: input, reasons: [...reasons, r] });

  let sql = input.trim();
  if (!sql) return reject("empty SQL");
  if (/--|\/\*|\*\//.test(sql)) return reject("comments are not allowed");
  sql = sql.replace(/;\s*$/, "");
  if (sql.includes(";")) return reject("multiple statements (;) are not allowed");

  let ast: any;
  try { ast = parser.astify(sql, PG); } catch (e: any) { return reject(`could not parse SQL (${String(e.message).slice(0, 120)})`); }
  if (Array.isArray(ast)) { if (ast.length !== 1) return reject("exactly one statement is allowed"); ast = ast[0]; }
  if (ast?.type !== "select") return reject(`only SELECT is allowed (got ${String(ast?.type).toUpperCase()})`);

  const s = loadSemantic();
  const allowedViews = new Set(s.columnsByView.keys());
  const knownColumns = new Set([...s.columnsByView.values()].flatMap((c) => [...c]));
  const cteNames = new Set<string>();
  const aliases = new Set<string>();
  const columnsUsed = new Set<string>();
  const functionsUsed = new Set<string>();
  const tablesUsed: string[] = [];

  const visit = (node: any): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node.with)) for (const w of node.with) cteNames.add(String(w?.name?.value ?? w?.name).toLowerCase());
    if (node.into?.position) reasons.push("SELECT ... INTO is not allowed");
    if (node.locking_read) reasons.push("FOR UPDATE / FOR SHARE is not allowed");
    if (typeof node.as === "string") aliases.add(node.as.toLowerCase());
    if (node.as?.value) aliases.add(String(node.as.value).toLowerCase());

    if (Array.isArray(node.from)) for (const f of node.from) {
      if (f?.table) tablesUsed.push(`${f.db ? `${String(f.db).toLowerCase()}.` : ""}${String(f.table).toLowerCase()}`);
    }
    if (node.type === "column_ref") {
      const col = node.column?.expr?.value ?? node.column;
      if (typeof col === "string") columnsUsed.add(col.toLowerCase());
    }
    if (node.type === "function") {
      const parts = (node.name?.name ?? []).map((p: any) => String(p.value).toLowerCase());
      functionsUsed.add(parts.join("."));
    }
    if (node.type === "aggr_func" || node.type === "window_func") functionsUsed.add(String(node.name).toLowerCase());

    for (const v of Object.values(node)) visit(v);
  };
  visit(ast);

  for (const t of parser.tableList(sql, PG)) {
    const [op, db, table] = t.split("::");
    if (op.toLowerCase() !== "select") reasons.push(`operation ${op} is not allowed`);
    const name = db && db !== "null" ? `${db.toLowerCase()}.${table.toLowerCase()}` : table.toLowerCase();
    if (!tablesUsed.includes(name)) tablesUsed.push(name);
  }

  for (const t of new Set(tablesUsed)) {
    if (allowedViews.has(t) || cteNames.has(t)) continue;
    reasons.push(t.includes(".") ? `table ${t} is not allowed (only ${[...allowedViews].join(", ")})` : `unknown table ${t} (use the full name, e.g. clean.overall_ranking)`);
  }
  for (const f of functionsUsed) if (!ALLOWED_FUNCTIONS.has(f)) reasons.push(`function ${f}() is not allowed`);
  for (const c of columnsUsed) {
    if (c === "*" || knownColumns.has(c) || aliases.has(c)) continue;
    reasons.push(`unknown column ${c}`);
  }
  if (reasons.length) return { ok: false, sql: input, reasons: [...new Set(reasons)] };

  const limitValues: any[] = ast.limit?.value ?? [];
  if (limitValues.length === 0) {
    sql = `${sql}\nLIMIT ${MAX_ROWS}`;
    reasons.push(`added LIMIT ${MAX_ROWS}`);
  } else {
    const n = Number(limitValues[0]?.value);
    if (!Number.isInteger(n)) return reject("LIMIT must be a plain number");
    if (n > MAX_ROWS) {
      const m = [...sql.matchAll(/\blimit\s+\d+/gi)].pop();
      if (!m || m.index === undefined) return reject("could not cap LIMIT");
      sql = sql.slice(0, m.index) + `LIMIT ${MAX_ROWS}` + sql.slice(m.index + m[0].length);
      reasons.push(`capped LIMIT ${n} to ${MAX_ROWS}`);
    }
  }
  return { ok: true, sql, reasons };
}

export function sqlFacts(sql: string): { strings: string[]; columns: string[] } {
  let ast: any;
  try { ast = parser.astify(sql, PG); } catch { return { strings: [], columns: [] }; }
  const strings = new Set<string>(), columns = new Set<string>();
  const visit = (n: any): void => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!n || typeof n !== "object") return;
    if ((n.type === "single_quote_string" || n.type === "string") && typeof n.value === "string") strings.add(n.value);
    if (n.type === "column_ref") { const c = n.column?.expr?.value ?? n.column; if (typeof c === "string") columns.add(c.toLowerCase()); }
    for (const v of Object.values(n)) visit(v);
  };
  visit(ast);
  return { strings: [...strings], columns: [...columns] };
}
