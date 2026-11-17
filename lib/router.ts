import { loadSemantic, type Metric } from "./semantic";
import { YEARS, type Resolved } from "./resolve";

export const MAX_QUESTION_LENGTH = 300;

export type Route =
  | { kind: "definition"; text: string; metric?: Metric; groupId?: string }
  | { kind: "decline"; reason: "empty" | "too_long" | "year_out_of_range"; text: string }
  | { kind: "sql" };

const DEFINITION_WORDS = /\b(mean|means|meaning|definition|define|explain|explained)\b/i;
const WHAT_IS = /^\s*(what\s+(is|are|'s)|what's|whats)\s+/i;
const FILLER = /\b(the|a|an|of|by|in|this|data|guardian|table|tables|measure|metric|score|please|exactly|mean|means|meaning|definition|define|explain|explained|what|is|are|does|do|how|calculated|measured)\b/gi;

export function route(question: string, resolved: Resolved): Route {
  const q = question.trim();
  if (!q) return { kind: "decline", reason: "empty", text: "Please type a question about the Guardian university league tables (2013-2015)." };
  if (q.length > MAX_QUESTION_LENGTH) {
    return { kind: "decline", reason: "too_long", text: `That question is longer than ${MAX_QUESTION_LENGTH} characters. Please ask one short question at a time.` };
  }

  const s = loadSemantic();
  const metric = resolved.metrics[0];
  const group = resolved.groups[0];
  const onlyOneThing = resolved.metrics.length + resolved.groups.length === 1 && resolved.subjects.length === 0;
  const looksLikeDefinition = DEFINITION_WORDS.test(q) || (WHAT_IS.test(q) && leftoverIsFiller(q, resolved));
  if (looksLikeDefinition && onlyOneThing && resolved.universities.length === (group ? group.members.length : 0)) {
    if (metric && resolved.metricSource === "question") return { kind: "definition", metric, text: defineMetric(metric) };
    if (group) {
      const g = s.kg.groups.find((x) => x.id === group.id)!;
      const names = g.members.map((id) => s.universities.find((u) => u.id === id)!.canonical_name);
      return { kind: "definition", groupId: g.id, text: `**${g.name}** is a group in the knowledge graph, not a column in the data. In this app it means these ${names.length} universities: ${names.join(", ")}.\n\nSource: ${g.source}` };
    }
  }

  if (resolved.unsupportedYears.length) {
    return { kind: "decline", reason: "year_out_of_range", text: `The data only covers the ${YEARS.join(", ")} Guardian tables, so I can't answer about ${resolved.unsupportedYears.join(", ")}. I don't make predictions.` };
  }
  return { kind: "sql" };
}

function leftoverIsFiller(q: string, r: Resolved): boolean {
  let rest = ` ${q.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  const s = loadSemantic();
  const words = [
    ...r.metrics.flatMap((m) => [m.id.replace(/_/g, " "), m.label, ...Object.entries(s.layer.synonyms).filter(([, t]) => t === m.id).map(([w]) => w)]),
    ...r.groups.flatMap((g) => s.kg.groups.find((x) => x.id === g.id)!.aliases),
  ].map((w) => w.toLowerCase()).sort((a, b) => b.length - a.length);
  for (const w of words) rest = rest.split(` ${w} `).join(" ").split(` ${w}s `).join(" ");
  return rest.replace(FILLER, " ").trim() === "";
}

export function defineMetric(m: Metric): string {
  const better = m.direction === "lower_is_better" ? "Lower is better." : "Higher is better.";
  const lines = [`**${m.label}**: ${m.description.trim()}`, "", `- Unit: ${m.unit} (${m.scale})`, `- ${better}`];
  if (m.null_caveat) lines.push(`- Missing data: ${m.null_caveat.trim()}`);
  if (m.needs_review) lines.push("", "_This definition is awaiting review._");
  return lines.join("\n");
}
