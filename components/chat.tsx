"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, CalendarDays, ChevronRight, Gauge, Loader2, PanelLeft, Sparkles, X } from "lucide-react";
import type { AskResult } from "@/lib/ask";
import type { Demo } from "@/lib/demos";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AnswerCard } from "./answer-card";
import { ModelPicker } from "./model-picker";
import { DEFAULT_MODEL_KEY } from "@/lib/models";

export type GlossaryItem = { id: string; label: string; description: string; unit: string; direction: string };
type Message = { id: number; question: string; context: { year?: number; metricId?: string }; result?: AskResult; error?: string };

const ANY = "any";

export function Chat({ demos, glossary, years }: { demos: Demo[]; glossary: GlossaryItem[]; years: number[] }) {
  const [year, setYear] = useState<string>(ANY);
  const [metric, setMetric] = useState<string>(ANY);
  const [modelKey, setModelKey] = useState<string>(DEFAULT_MODEL_KEY);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState<boolean | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(question: string, override?: { year?: number; metricId?: string }) {
    if (!question.trim() || busy) return;
    const context = override ?? { year: year === ANY ? undefined : Number(year), metricId: metric === ANY ? undefined : metric };
    const id = Date.now();
    setMessages((m) => [...m, { id, question, context }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, ...context, modelKey }) });
      const json = await res.json();
      setMessages((m) => m.map((x) => (x.id === id ? (res.ok ? { ...x, result: json } : { ...x, error: json.error ?? "Request failed." }) : x)));
    } catch {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, error: "Couldn't reach the server." } : x)));
    } finally {
      setBusy(false);
    }
  }

  const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;
  const toggleSidebar = () => setSidebar((s) => (s === null ? !isDesktop() : !s));

  function askDemo(d: Demo) {
    if (!isDesktop()) setSidebar(false);
    setYear(d.context?.year ? String(d.context.year) : ANY);
    setMetric(d.context?.metricId ?? ANY);
    send(d.question, d.context ?? {});
  }

  const yearItems = [{ value: ANY, label: "Any year" }, ...years.map((y) => ({ value: String(y), label: String(y) }))];
  const metricItems = [{ value: ANY, label: "Any metric" }, ...glossary.map((g) => ({ value: g.id, label: g.label }))];

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <button onClick={toggleSidebar} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Toggle sidebar">
          <PanelLeft className="size-5" />
        </button>
        <div className="mr-auto flex items-baseline gap-2" title="GUL = Guardian University League">
          <h1 className="text-2xl font-extrabold tracking-tighter text-[#3B82F6]">GULLY</h1>
          <span className="hidden font-heading text-sm font-medium text-muted-foreground sm:inline">Guardian ranking AI</span>
        </div>
        <ModelPicker value={modelKey} onChange={setModelKey} />
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebar && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebar(false)} />}
        <aside className={`${sidebar === null ? "hidden lg:block" : sidebar ? "block" : "hidden"} fixed inset-y-0 left-0 z-40 w-80 shrink-0 overflow-y-auto border-r bg-background p-4 shadow-lg animate-in slide-in-from-left-4 lg:static lg:z-auto lg:shadow-none`}>
          <button onClick={() => setSidebar(false)} className="mb-2 ml-auto flex rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Close sidebar">
            <X className="size-4" />
          </button>
          <SidebarSection icon={<Sparkles className="size-4" />} title="Quick questions" defaultOpen={false}>
            <ul className="space-y-1">
              {demos.map((d) => (
                <li key={d.label}>
                  <button onClick={() => askDemo(d)} disabled={busy} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50">
                    {d.label}<span className="block text-xs text-muted-foreground">{d.shows}</span>
                  </button>
                </li>
              ))}
            </ul>
          </SidebarSection>
          <SidebarSection icon={<BookOpen className="size-4" />} title="Metric glossary" defaultOpen>
            <dl className="space-y-3 px-2">
              {glossary.map((g) => (
                <div key={g.id}>
                  <dt className="text-sm font-medium">{g.label}</dt>
                  <dd className="text-xs text-muted-foreground">{g.description} <span className="whitespace-nowrap">({g.unit}, {g.direction === "lower_is_better" ? "lower is better" : "higher is better"})</span></dd>
                </div>
              ))}
            </dl>
          </SidebarSection>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.length === 0 && (
                <div className="py-10 text-center">
                  <h2 className="text-3xl font-bold">Ask the league tables anything.</h2>
                  <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                    Ranks, scores, satisfaction, spending, staff ratios, career prospects, value added or entry tariff, overall or by subject,
                    2013–2015. Open <strong>How I got this</strong> under any answer to see every step.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {demos.slice(0, 4).map((d) => <button key={d.label} onClick={() => askDemo(d)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{d.label}</button>)}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className="flex flex-col gap-2">
                  <div className="self-end rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                    {m.question}
                    {(m.context.year || m.context.metricId) && (
                      <span className="block text-xs opacity-75">
                        {[m.context.year && `year ${m.context.year}`, m.context.metricId && `metric ${glossary.find((g) => g.id === m.context.metricId)?.label}`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {m.result ? <AnswerCard result={m.result} onAsk={(q) => send(q)} />
                    : m.error ? <p className="text-sm text-destructive">{m.error}</p>
                    : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Resolving names, writing SQL, checking it, querying…</p>}
                </div>
              ))}
              <div ref={bottom} />
            </div>
          </div>
          <form className="p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <div className="mx-auto max-w-3xl rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} rows={1} placeholder="e.g. Top 10 for career prospects in Law 2014"
                className="max-h-32 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
              <div className="mt-1 flex items-center gap-1.5">
                <ChipSelect icon={<CalendarDays className="size-3.5" />} label="Year" items={yearItems} value={year} onChange={setYear} />
                <ChipSelect icon={<Gauge className="size-3.5" />} label="Metric" items={metricItems} value={metric} onChange={setMetric} />
                <Button type="submit" size="icon" className="ml-auto rounded-full" disabled={busy || !input.trim()} aria-label="Ask"><ArrowUp className="size-4" /></Button>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

function SidebarSection({ icon, title, defaultOpen, children }: { icon: React.ReactNode; title: string; defaultOpen: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="mb-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted">
        {icon}
        <h2 className="text-base font-semibold">{title}</h2>
        <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden pt-1 transition-[height] duration-200 data-[ending-style]:h-0 data-[starting-style]:h-0">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChipSelect({ icon, label, items, value, onChange }: { icon: React.ReactNode; label: string; items: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const set = value !== ANY;
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ANY))}>
      <SelectTrigger size="sm" aria-label={label}
        className={`h-7 gap-1 rounded-full border-0 data-[size=sm]:rounded-full px-2.5 text-xs shadow-none ${set ? "bg-primary text-primary-foreground [&_svg]:text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
        {icon}<SelectValue />
      </SelectTrigger>
      <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
