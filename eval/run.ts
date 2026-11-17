import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const [providerArg, modelArg] = process.argv.slice(2);
if (providerArg) process.env.LLM_PROVIDER = providerArg;
if (modelArg) process.env.LLM_MODEL = modelArg;
const provider = process.env.LLM_PROVIDER ?? "anthropic";
const model = process.env.LLM_MODEL ?? "claude-haiku-5-5";

const { ask } = await import("../lib/ask");
const { runQuery, closeDb } = await import("../lib/db");

type Question = { id: string; question: string; context?: { year?: number; metricId?: string }; expect: string; ordered?: boolean; note?: string };
type Gold = { id: string; expect: string; sql?: string; reasoning?: string; disagree?: string };
type Row = Record<string, unknown>;

const questions: Question[] = parse(readFileSync("eval/questions.yml", "utf8")).questions;
const gold = new Map<string, Gold>((parse(readFileSync("eval/gold.yml", "utf8")).gold as Gold[]).map((g) => [g.id, g]));

function same(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === "number" && typeof b === "number") {
    const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;
    const d = Math.min(decimals(a), decimals(b), 6);
    return Math.abs(a - b) <= 0.5 * 10 ** -d + 1e-9;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function mapColumns(goldRows: Row[], actualRows: Row[]): Record<string, string> | null {
  const actualCols = actualRows.length ? Object.keys(actualRows[0]) : [];
  const map: Record<string, string> = {};
  for (const col of Object.keys(goldRows[0] ?? {})) {
    if (actualCols.includes(col)) { map[col] = col; continue; }
    const covers = (ac: string) => goldRows.every((g) => actualRows.some((a) => same(g[col], a[ac])));
    const found = actualCols.find((ac) => !Object.values(map).includes(ac) && covers(ac));
    if (!found) return null;
    map[col] = found;
  }
  return map;
}

function compare(goldRows: Row[], actualRows: Row[], ordered: boolean): { verdict: "PASS" | "PARTIAL" | "FAIL"; why: string } {
  if (goldRows.length === 0) return actualRows.length === 0 ? { verdict: "PASS", why: "both empty" } : { verdict: "FAIL", why: "gold is empty, pipeline returned rows" };
  const map = mapColumns(goldRows, actualRows);
  if (!map) return { verdict: "FAIL", why: "a gold column has no matching column/values in the pipeline result" };
  const rowSame = (g: Row, a: Row) => Object.entries(map).every(([gc, ac]) => same(g[gc], a[ac]));
  if (ordered) {
    const exact = goldRows.length === actualRows.length && goldRows.every((g, i) => rowSame(g, actualRows[i]));
    if (exact) return { verdict: "PASS", why: "same rows, same order" };
  } else {
    const left = [...actualRows];
    const all = goldRows.every((g) => { const i = left.findIndex((a) => rowSame(g, a)); if (i < 0) return false; left.splice(i, 1); return true; });
    if (all && left.length === 0) return { verdict: "PASS", why: "same rows" };
  }
  const contained = goldRows.every((g) => actualRows.some((a) => rowSame(g, a)));
  if (contained) return { verdict: "PARTIAL", why: `all ${goldRows.length} gold rows present, but ${actualRows.length} rows returned${ordered ? " or order differs" : ""}` };
  return { verdict: "FAIL", why: `rows differ (gold ${goldRows.length}, pipeline ${actualRows.length})` };
}

const OUTCOME_FOR: Record<string, (o: string) => boolean> = {
  definition: (o) => o === "definition",
  clarification: (o) => o === "clarification",
  decline: (o) => o.startsWith("declined"),
};

type Line = { q: Question; outcome: string; verdict: string; why: string; ms: number; cost: number; guardRejected: boolean; sql: string | null; goldRows: Row[]; actualRows: Row[] };
const lines: Line[] = [];

for (const q of questions) {
  const g = gold.get(q.id);
  if (!g) throw new Error(`no gold entry for ${q.id}`);
  const r = await ask(q.question, q.context ?? {});
  const guardRejected = r.trace.steps.some((s) => s.step.startsWith("guard") && (s.detail as { ok?: boolean })?.ok === false);
  let verdict = "FAIL", why = "", goldRows: Row[] = [];
  if (g.expect === "answer") {
    const gr = await runQuery(g.sql ?? "");
    if (!gr.ok) throw new Error(`gold SQL for ${q.id} failed: ${gr.error}`);
    goldRows = gr.rows;
    if (r.outcome === "answered" || r.outcome === "empty_result") ({ verdict, why } = compare(goldRows, r.trace.rows, !!q.ordered));
    else why = `expected an answer, got ${r.outcome}`;
  } else {
    const ok = OUTCOME_FOR[g.expect]?.(r.outcome) ?? false;
    verdict = ok ? "PASS" : "FAIL";
    why = ok ? r.outcome : `expected ${g.expect}, got ${r.outcome}`;
  }
  lines.push({ q, outcome: r.outcome, verdict, why, ms: r.trace.totals.ms, cost: r.trace.totals.costUsd, guardRejected, sql: r.trace.sql, goldRows, actualRows: r.trace.rows });
  console.log(`${verdict.padEnd(7)} ${q.id.padEnd(20)} ${r.outcome.padEnd(15)} ${String(r.trace.totals.ms).padStart(5)} ms  ${why}`);
}
await closeDb();

const isAnswer = (l: Line) => gold.get(l.q.id)!.expect !== "decline";
const answers = lines.filter(isAnswer), declines = lines.filter((l) => !isAnswer(l));
const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const totals = {
  answer: pct(answers.filter((l) => l.verdict === "PASS").length, answers.length),
  partial: answers.filter((l) => l.verdict === "PARTIAL").length,
  decline: pct(declines.filter((l) => l.verdict === "PASS").length, declines.length),
  guard: lines.filter((l) => l.guardRejected).length,
  ms: Math.round(avg(lines.map((l) => l.ms))),
  cost: avg(lines.map((l) => l.cost)),
};
console.log(`\nAnswer accuracy ${totals.answer} (+${totals.partial} partial) · decline accuracy ${totals.decline} · guard rejections ${totals.guard} · avg ${totals.ms} ms · avg $${totals.cost.toFixed(5)}/question`);

const show = (rows: Row[]) => rows.length ? rows.slice(0, 6).map((r) => JSON.stringify(r)).join("<br>") + (rows.length > 6 ? `<br>… ${rows.length} rows` : "") : "(none)";
const md = [
  `# Eval results: ${provider} / ${model}`,
  "",
  `Run ${new Date().toISOString()} · ${lines.length} questions · gold from eval/gold.yml (written independently, see eval/GOLD_BRIEF.md).`,
  "",
  "| Measure | Value |", "|---|---|",
  `| Answer accuracy (exact match with gold) | ${totals.answer} |`,
  `| Partial (all gold rows present, plus extra rows) | ${totals.partial} |`,
  `| Decline accuracy | ${totals.decline} |`,
  `| Questions with a guard rejection | ${totals.guard} |`,
  `| Average latency | ${totals.ms} ms |`,
  `| Average cost per question | $${totals.cost.toFixed(5)} |`,
  "",
  "| Verdict | Id | Question | Outcome | ms | Why |", "|---|---|---|---|---|---|",
  ...lines.map((l) => `| ${l.verdict} | ${l.q.id} | ${l.q.question}${l.q.context?.metricId ? ` (metric: ${l.q.context.metricId})` : ""} | ${l.outcome} | ${l.ms} | ${l.why} |`),
  "",
  "## Not passed",
  "",
  ...lines.filter((l) => l.verdict !== "PASS").flatMap((l) => [
    `### ${l.verdict}: ${l.q.id}`,
    `- Question: ${l.q.question}`,
    `- Outcome: ${l.outcome}. ${l.why}`,
    `- Pipeline SQL: \`${(l.sql ?? "(none)").replace(/\s+/g, " ")}\``,
    `- Gold SQL: \`${(gold.get(l.q.id)!.sql ?? "(none)").replace(/\s+/g, " ")}\``,
    `- Gold rows: ${show(l.goldRows)}`,
    `- Pipeline rows: ${show(l.actualRows)}`,
    "",
  ]),
].join("\n");
const file = `eval/results-${provider}-${model}.md`;
writeFileSync(file, md);
console.log(`Wrote ${file}`);
