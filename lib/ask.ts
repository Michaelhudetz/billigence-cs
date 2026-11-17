import { route } from "./router";
import { resolve, type Resolved } from "./resolve";
import { systemPrompt, userPrompt, type LlmOutput } from "./prompt";
import { generateSql, llmConfig, type LlmCall, type LlmChoice } from "./llm";
import { guardSql, sqlFacts, type GuardResult } from "./guard";
import { runQuery, logQuery } from "./db";
import { buildAnswer, declineText, type ChartSpec } from "./answer";
import { loadSemantic } from "./semantic";

export type Outcome =
  | "answered" | "empty_result" | "definition" | "clarification"
  | "declined_router" | "declined_llm" | "guard_rejected" | "check_failed" | "db_error" | "llm_error";

export type TraceStep = { step: string; ms: number; detail: unknown };
export type AskResult = {
  answer: string;
  chart: ChartSpec | null;
  outcome: Outcome;
  clarification: { text: string; candidates: string[]; matched: string } | null;
  trace: {
    question: string;
    context: { year?: number; metricId?: string };
    steps: TraceStep[];
    resolved: Resolved | null;
    plan: LlmOutput | null;
    sql: string | null;
    guard: GuardResult | null;
    rows: Record<string, unknown>[];
    totals: { ms: number; llmCalls: number; tokensIn: number; tokensOut: number; costUsd: number; provider: string | null; model: string | null };
  };
};

const MAX_ATTEMPTS = 2;

export async function ask(question: string, context: { year?: number; metricId?: string } = {}, opts: { llm?: LlmChoice } = {}): Promise<AskResult> {
  const started = Date.now();
  const steps: TraceStep[] = [];
  const time = <T>(step: string, fn: () => T, detail?: (v: T) => unknown): T => {
    const t = Date.now(); const v = fn(); steps.push({ step, ms: Date.now() - t, detail: detail ? detail(v) : v }); return v;
  };
  const llmCalls: LlmCall[] = [];
  const result: AskResult = {
    answer: "", chart: null, outcome: "answered", clarification: null,
    trace: { question, context, steps, resolved: null, plan: null, sql: null, guard: null, rows: [], totals: { ms: 0, llmCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, provider: null, model: null } },
  };
  const finish = (outcome: Outcome, answer: string) => {
    result.outcome = outcome; result.answer = answer;
    const t = result.trace.totals;
    t.ms = Date.now() - started; t.llmCalls = llmCalls.length;
    t.tokensIn = llmCalls.reduce((a, c) => a + c.tokensIn, 0); t.tokensOut = llmCalls.reduce((a, c) => a + c.tokensOut, 0);
    t.costUsd = llmCalls.reduce((a, c) => a + (c.costUsd ?? 0), 0);
    if (llmCalls.length) { t.provider = llmCalls[0].provider; t.model = llmCalls[0].model; }
    return result;
  };

  const resolved = time("resolve", () => resolve(question.slice(0, 1000), context));
  result.trace.resolved = resolved;

  const r = time("router", () => route(question, resolved));
  if (r.kind === "definition") return finish("definition", r.text);
  if (r.kind === "decline") return finish("declined_router", r.text);
  if (resolved.clarification) {
    result.clarification = resolved.clarification;
    return finish("clarification", `${resolved.clarification.text}\n\n_Please ask again with one of: ${resolved.clarification.candidates.join(", ")}._`);
  }

  const system = systemPrompt();
  let previousError: string | undefined;
  let lastFailure: { outcome: Outcome; reason: string; detail: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let call: LlmCall;
    const t0 = Date.now();
    try {
      call = await generateSql(system, userPrompt(question, resolved, previousError), opts.llm);
    } catch (e: any) {
      steps.push({ step: `llm (attempt ${attempt})`, ms: Date.now() - t0, detail: { error: String(e.message ?? e) } });
      lastFailure = { outcome: "llm_error", reason: "llm_error", detail: "" };
      break;
    }
    llmCalls.push(call);
    steps.push({ step: `llm (attempt ${attempt})`, ms: call.latencyMs, detail: { provider: call.provider, model: call.model, tokensIn: call.tokensIn, tokensOut: call.tokensOut, costUsd: call.costUsd, output: call.json ?? call.raw } });

    const shapeError = checkShape(call.json);
    if (shapeError) { previousError = shapeError; lastFailure = { outcome: "check_failed", reason: "bad_output", detail: shapeError }; continue; }
    const plan = call.json as LlmOutput;
    result.trace.plan = plan;

    if (plan.intent === "out_of_scope") {
      return finish("declined_llm", declineText(plan.out_of_scope_reason ?? "not_in_data"));
    }

    const guard = time(`guard (attempt ${attempt})`, () => guardSql(plan.sql));
    result.trace.guard = guard;
    if (!guard.ok) { previousError = `The SQL guard rejected the query: ${guard.reasons.join("; ")}`; lastFailure = { outcome: "guard_rejected", reason: "guard", detail: guard.reasons.join("; ") }; continue; }

    const checkError = time(`checks (attempt ${attempt})`, () => checkConsistency(plan, guard.sql, resolved), (v) => v ?? "ok");
    if (checkError) { previousError = checkError; lastFailure = { outcome: "check_failed", reason: "bad_output", detail: checkError }; continue; }

    const res = await runQuery(guard.sql);
    steps.push({ step: `database (attempt ${attempt})`, ms: res.ms, detail: res.ok ? { rows: res.rows.length } : { error: res.error } });
    if (!res.ok) { previousError = `The database returned an error: ${res.error}`; lastFailure = { outcome: "db_error", reason: "db_error", detail: res.error }; continue; }

    result.trace.sql = guard.sql;
    result.trace.rows = res.rows;
    const answer = time("answer", () => buildAnswer(res.rows, plan, resolved), (a) => ({ chars: a.text.length, chart: a.chart?.type ?? null }));
    result.chart = answer.chart;
    return finish(res.rows.length ? "answered" : "empty_result", answer.text);
  }

  const f = lastFailure ?? { outcome: "llm_error" as Outcome, reason: "llm_error", detail: "" };
  return finish(f.outcome, declineText(f.reason, f.detail ? `Last error: ${f.detail}` : undefined));
}

function checkShape(j: any): string | null {
  if (!j || typeof j !== "object") return "The reply was not a JSON object.";
  if (j.intent !== "sql" && j.intent !== "out_of_scope") return 'intent must be "sql" or "out_of_scope".';
  if (j.intent === "out_of_scope") return null;
  if (j.table !== "overall_ranking" && j.table !== "subject_ranking") return 'table must be "overall_ranking" or "subject_ranking".';
  if (!Array.isArray(j.metric_ids)) return "metric_ids must be a list.";
  if (!["single", "ranked_list", "comparison", "trend"].includes(j.answer_shape)) return "answer_shape is invalid.";
  if (typeof j.sql !== "string" || !j.sql.trim()) return "sql is empty.";
  return null;
}

function checkConsistency(plan: LlmOutput, sql: string, r: Resolved): string | null {
  const s = loadSemantic();
  const unknown = plan.metric_ids.filter((id) => !s.metricById.has(id));
  if (unknown.length) return `metric_ids contains unknown metrics: ${unknown.join(", ")}. Valid ids: ${[...s.metricById.keys()].join(", ")}.`;
  const view = `clean.${plan.table}`;
  if (!new RegExp(`\\b${view.replace(".", "\\.")}\\b`, "i").test(sql)) return `table is "${plan.table}" but the SQL does not query ${view}.`;

  const facts = sqlFacts(sql);
  const metricOfColumn = new Map(s.layer.metrics.map((m) => [m.columns[view], m.id]));
  const usedMetrics = new Set(facts.columns.map((c) => metricOfColumn.get(c)).filter((x): x is string => !!x));
  const notUsed = plan.metric_ids.filter((id) => !usedMetrics.has(id));
  if (notUsed.length) return `metric_ids lists ${notUsed.join(", ")}, but the SQL doesn't use ${notUsed.length > 1 ? "them" : "it"}.`;
  const asked = r.metrics.filter((m) => m.id !== "rank").map((m) => m.id);
  const missingAsked = asked.filter((id) => !usedMetrics.has(id));
  if (missingAsked.length) {
    return `The question is about ${missingAsked.join(", ")} (column ${missingAsked.map((id) => s.metricById.get(id)!.columns[view]).join(", ")}), but the SQL doesn't use it. "Ranks Nth" or "best" means position by that metric: use RANK() OVER (ORDER BY that column ...).`;
  }

  const allowed = new Set([...r.universities.map((u) => u.id), ...r.subjects.map((x) => x.id), "publisher", "corrected", "derived"]);
  const invented = facts.strings.filter((x) => !allowed.has(x));
  if (invented.length) return `The SQL uses literals that are not resolved ids: ${invented.map((x) => `'${x}'`).join(", ")}. Use only the ids under RESOLVED ENTITIES.`;
  return null;
}

export function logAsk(res: AskResult): Promise<void> {
  const t = res.trace.totals;
  const { provider, model } = t.provider ? t : { ...llmConfig() };
  return logQuery({
    question: res.trace.question,
    resolved_entities: res.trace.resolved
      ? { years: res.trace.resolved.years, universities: res.trace.resolved.universities.map((u) => u.id), subjects: res.trace.resolved.subjects.map((x) => x.id), metrics: res.trace.resolved.metrics.map((m) => m.id), kgRules: res.trace.resolved.kgRules }
      : null,
    provider: t.llmCalls ? provider : null, model: t.llmCalls ? model : null,
    sql: res.trace.sql ?? res.trace.plan?.sql ?? null,
    guard_result: res.trace.guard, row_count: res.trace.sql ? res.trace.rows.length : null,
    latency_ms: t.ms, tokens_in: t.tokensIn || null, tokens_out: t.tokensOut || null, cost_usd: t.costUsd || null, outcome: res.outcome,
  });
}
