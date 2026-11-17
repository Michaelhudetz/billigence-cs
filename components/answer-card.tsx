"use client";
import { useState } from "react";
import { ChevronRight, ShieldCheck, ShieldX, Sparkles, Database, Network, Search, Timer } from "lucide-react";
import type { AskResult } from "@/lib/ask";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RichText, formatSql } from "./rich-text";
import { AnswerChart } from "./answer-chart";

const OUTCOME_LABEL: Record<string, { text: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  answered: { text: "Answered from the data", tone: "default" },
  empty_result: { text: "No matching data", tone: "secondary" },
  definition: { text: "Definition from the semantic layer, no AI", tone: "secondary" },
  clarification: { text: "Needs clarification", tone: "outline" },
  declined_router: { text: "Declined before the AI", tone: "outline" },
  declined_llm: { text: "Declined: not answerable from the data", tone: "outline" },
  guard_rejected: { text: "Blocked by the SQL guard", tone: "destructive" },
  check_failed: { text: "Blocked by a consistency check", tone: "destructive" },
  db_error: { text: "Database error", tone: "destructive" },
  llm_error: { text: "AI error", tone: "destructive" },
};

function withChoice(question: string, matched: string, choice: string) {
  const re = new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\W+"), "i");
  return re.test(question) ? question.replace(re, choice) : `${question} (${choice})`;
}

export function AnswerCard({ result, onAsk }: { result: AskResult; onAsk: (q: string) => void }) {
  const outcome = OUTCOME_LABEL[result.outcome] ?? { text: result.outcome, tone: "outline" as const };
  return (
    <Card className="w-full">
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={outcome.tone}>{outcome.text}</Badge>
          <span className="text-xs text-muted-foreground">
            {result.trace.totals.ms} ms · {result.trace.totals.llmCalls} AI call{result.trace.totals.llmCalls === 1 ? "" : "s"}
            {result.trace.totals.costUsd > 0 && ` · $${result.trace.totals.costUsd.toFixed(5)}`}
          </span>
        </div>
        <RichText text={result.answer} />
        {result.clarification && (
          <div className="flex flex-wrap gap-2">
            {result.clarification.candidates.map((c) => (
              <button key={c} onClick={() => onAsk(withChoice(result.trace.question, result.clarification!.matched, c))}
                className="rounded-full border px-3 py-1 text-sm hover:bg-muted">{c}</button>
            ))}
          </div>
        )}
        {result.chart && <AnswerChart spec={result.chart} />}
        <Trace result={result} />
      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">{icon}{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Trace({ result }: { result: AskResult }) {
  const [open, setOpen] = useState(false);
  const { trace } = result;
  const r = trace.resolved;
  const llmSteps = trace.steps.filter((s) => s.step.startsWith("llm"));
  const guardSteps = trace.steps.filter((s) => s.step.startsWith("guard"));
  const checkSteps = trace.steps.filter((s) => s.step.startsWith("checks"));
  const dbSteps = trace.steps.filter((s) => s.step.startsWith("database"));
  const columns = trace.rows.length ? Object.keys(trace.rows[0]) : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left font-heading text-sm font-semibold hover:bg-muted/60">
        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} /> How I got this
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-3 py-3">
        {r && (
          <Section icon={<Search className="size-3.5" />} title="1. Resolved entities (code, no AI)">
            <ul className="space-y-0.5">
              <li>Years: {r.years.join(", ")} <span className="text-muted-foreground">({r.yearSource})</span></li>
              {r.universities.length > 0 && <li>Universities: {r.universities.map((u) => `${u.name} [${u.how}]`).join("; ")}</li>}
              {r.subjects.length > 0 && <li>Subjects: {r.subjects.map((s) => `${s.name} (${s.id})`).join("; ")}</li>}
              {r.metrics.length > 0 && <li>Metrics: {r.metrics.map((m) => m.label).join(", ")} <span className="text-muted-foreground">({r.metricSource})</span></li>}
              {r.assumptions.map((a) => <li key={a} className="text-muted-foreground">Assumption: {a}</li>)}
            </ul>
          </Section>
        )}
        {r && r.kgRules.length > 0 && (
          <Section icon={<Network className="size-3.5" />} title="2. Knowledge graph rules">
            <ul className="space-y-0.5">{r.kgRules.map((k) => <li key={k} className="break-words">{k}</li>)}</ul>
          </Section>
        )}
        {llmSteps.map((s, i) => {
          const d: any = s.detail;
          return (
            <Section key={s.step} icon={<Sparkles className="size-3.5" />} title={`3. AI writes SQL (${s.step.replace("llm ", "")})`}>
              {d?.error ? <p className="text-destructive">{d.error}</p> : (
                <>
                  <p className="text-muted-foreground">{d.provider} / {d.model} · {d.tokensIn} in / {d.tokensOut} out tokens · {s.ms} ms · ${Number(d.costUsd ?? 0).toFixed(5)}</p>
                  {d.output?.intent === "out_of_scope"
                    ? <p>Returned <code>out_of_scope</code> ({d.output.out_of_scope_reason}).</p>
                    : d.output?.sql && <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">{formatSql(d.output.sql)}</pre>}
                  {checkSteps[i] && checkSteps[i].detail !== "ok" && <p className="mt-1 text-destructive">Check failed: {String(checkSteps[i].detail)}</p>}
                  {guardSteps[i] && !(guardSteps[i].detail as any).ok && <p className="mt-1 text-destructive">Guard rejected: {(guardSteps[i].detail as any).reasons.join("; ")}</p>}
                  {dbSteps[i] && (dbSteps[i].detail as any).error && <p className="mt-1 text-destructive">Database error: {(dbSteps[i].detail as any).error}</p>}
                </>
              )}
            </Section>
          );
        })}
        {trace.guard && (
          <Section icon={trace.guard.ok ? <ShieldCheck className="size-3.5" /> : <ShieldX className="size-3.5" />} title="4. SQL guard">
            <p>{trace.guard.ok ? "Passed: one read-only SELECT on allowed views, columns and functions." : "Rejected."}
              {trace.guard.reasons.length > 0 && <span className="text-muted-foreground"> {trace.guard.reasons.join("; ")}.</span>}</p>
            {trace.sql && <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">{formatSql(trace.sql)}</pre>}
          </Section>
        )}
        {trace.sql && (
          <Section icon={<Database className="size-3.5" />} title={`5. Rows returned (${trace.rows.length}), read-only user`}>
            {trace.rows.length === 0 ? <p className="text-muted-foreground">No rows.</p> : (
              <div className="max-h-64 overflow-auto rounded border bg-background">
                <Table>
                  <TableHeader><TableRow>{columns.map((c) => <TableHead key={c} className="text-xs">{c}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {trace.rows.map((row, i) => (
                      <TableRow key={i}>{columns.map((c) => <TableCell key={c} className="max-w-64 truncate text-xs" title={String(row[c] ?? "")}>{row[c] === null ? "∅" : typeof row[c] === "number" ? Number(row[c]).toLocaleString("en-GB", { maximumFractionDigits: 2 }) : String(row[c])}</TableCell>)}</TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        )}
        <Section icon={<Timer className="size-3.5" />} title="Timing, tokens and cost">
          <p>{trace.steps.map((s) => `${s.step} ${s.ms} ms`).join(" · ")}</p>
          <p className="text-muted-foreground">Total {trace.totals.ms} ms · {trace.totals.tokensIn} in / {trace.totals.tokensOut} out tokens · ${trace.totals.costUsd.toFixed(5)}{trace.totals.model ? ` · ${trace.totals.model}` : ""}</p>
        </Section>
      </CollapsibleContent>
    </Collapsible>
  );
}
