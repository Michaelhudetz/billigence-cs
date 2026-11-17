import { loadSemantic, type Metric } from "./semantic";
import type { Resolved } from "./resolve";
import type { LlmOutput } from "./prompt";

type Row = Record<string, any>;
export type ChartSpec =
  | { type: "bar"; title: string; unit: string; lowerIsBetter: boolean; data: { label: string; value: number }[] }
  | { type: "line"; title: string; unit: string; lowerIsBetter: boolean; series: { label: string; points: { year: number; value: number }[] }[] };
export type Answer = { text: string; chart: ChartSpec | null };

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function formatValue(m: Metric, v: unknown, view: string): string {
  if (v === null || v === undefined) return "no data";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const wholePoints = view === "clean.subject_ranking";
  switch (m.unit) {
    case "position": return ordinal(n);
    case "places": return n === 0 ? "no change" : `${n > 0 ? "+" : ""}${n} places`;
    case "percent": return `${n.toFixed(1)}%`;
    case "points out of 10": return `${wholePoints ? n : n.toFixed(1)}/10`;
    case "score": return `${Number.isInteger(n) ? n : n.toFixed(1)}/100`;
    case "students per member of staff": return `${n.toFixed(1)} students per member of staff`;
    case "UCAS tariff points": return `${Math.round(n)} UCAS points`;
    default: return `${n}`;
  }
}

export function buildAnswer(rows: Row[], plan: LlmOutput, r: Resolved): Answer {
  const s = loadSemantic();
  const view = plan.table === "subject_ranking" ? "clean.subject_ranking" : "clean.overall_ranking";
  const colOf = (m: Metric) => m.columns[view];
  const ordered = [...plan.metric_ids.map((id) => s.metricById.get(id)), ...s.layer.metrics].filter((m): m is Metric => !!m);
  const metrics = [...new Set(ordered)];
  const present = metrics.filter((m) => rows.some((row) => colOf(m) in row));
  const asked = r.metrics.find((m) => m.id !== "rank" && present.includes(m));
  const primary = asked ?? present.find((m) => m.id === "rank") ?? present[0];
  const years = [...new Set(rows.map((row) => row.year).filter((y) => y !== undefined))].sort() as number[];
  const yearText = (years.length ? years : r.years).join(", ");
  const subjectName = rows[0]?.subject_name as string | undefined;
  const where = subjectName ? ` ${subjectName}` : "";
  const lines: string[] = [];
  let chart: ChartSpec | null = null;

  const pos = (row: Row): number | null => (row.metric_rank ?? (primary?.id === "rank" ? row.rank : null)) ?? null;
  const showsRank = () => primary?.id === "rank";
  const values = (row: Row) =>
    present.filter((m) => !(m.id === "rank" && showsRank())).map((m) => `${m.label} ${formatValue(m, row[colOf(m)], view)}`).join(", ");
  const lowerNote = primary && primary.direction === "lower_is_better" && primary.id !== "rank" ? " (lower is better)" : "";
  const lastYear = Math.max(...(years.length ? years : r.years));
  const period = primary?.id === "places_climbed" ? `between ${lastYear - 1} and ${lastYear}` : `in ${yearText}`;
  const aboutLabel = !primary || primary.id === "rank" ? `in the ${yearText} Guardian${where} table` : `for ${primary.label.toLowerCase()}${lowerNote}${subjectName ? ` in${where}` : ""} ${period}`;

  if (rows.length === 0) {
    const who = r.universities.map((u) => u.name).concat(r.subjects.map((x) => x.name));
    lines.push(`I found no data for ${who.length ? who.slice(0, 6).join(", ") + (who.length > 6 ? "…" : "") : "this question"} in ${r.years.join(", ")}.`);
    for (const m of metrics) if (m.null_caveat) lines.push(`Note on ${m.label.toLowerCase()}: ${m.null_caveat.trim()}`);
  }
  else if (plan.answer_shape !== "trend" && pos(rows[0]) !== null && rows.every((row) => pos(row) === pos(rows[0])) && (plan.answer_shape === "single" || rows.length === 1)) {
    const p = ordinal(pos(rows[0])!);
    const detail = (row: Row) => { const v = values(row); return v ? ` (${v})` : ""; };
    if (rows.length === 1) lines.push(`**${rows[0].university_name}** is ${p} ${aboutLabel}${detail(rows[0])}.`);
    else lines.push(`${p} place ${aboutLabel} is shared by ${rows.length} universities:`, ...rows.map((row) => `- **${row.university_name}**${detail(row)}`));
  }
  else if (rows.length === 1 && plan.answer_shape === "single") {
    lines.push(`**${rows[0].university_name}** ${aboutLabel}: ${values(rows[0])}.`);
  }
  else if (plan.answer_shape === "trend" && primary) {
    const byUni = new Map<string, Row[]>();
    for (const row of rows) byUni.set(row.university_name, [...(byUni.get(row.university_name) ?? []), row]);
    lines.push(`${primary.label}${lowerNote}${where}, by year:`);
    for (const [name, rs] of byUni) {
      lines.push(`- **${name}**: ${rs.sort((a, b) => a.year - b.year).map((row) => `${row.year ?? ""} ${formatValue(primary, row[colOf(primary)], view)}`.trim()).join(" → ")}`);
    }
    chart = {
      type: "line", title: `${primary.label}${where}`, unit: primary.unit, lowerIsBetter: primary.direction === "lower_is_better",
      series: [...byUni].map(([label, rs]) => ({ label, points: rs.filter((x) => x.year && x[colOf(primary)] !== null).map((x) => ({ year: x.year, value: Number(x[colOf(primary)]) })) })),
    };
  }
  else {
    const header = plan.answer_shape === "ranked_list" ? `Results ${aboutLabel}:` : `${aboutLabel[0].toUpperCase()}${aboutLabel.slice(1)}:`;
    lines.push(header);
    const posCounts = new Map<number, number>();
    for (const row of rows) { const p0 = pos(row); if (p0 !== null) posCounts.set(p0, (posCounts.get(p0) ?? 0) + 1); }
    for (const row of rows) {
      const p0 = pos(row);
      const tag = p0 !== null ? `${p0}${(posCounts.get(p0) ?? 0) > 1 ? "=" : ""}. ` : "- ";
      const yr = years.length > 1 ? ` (${row.year})` : "";
      lines.push(`${tag}**${row.university_name}**${yr}: ${values(row) || "listed"}`);
    }
    if (primary && primary.unit !== "position" && rows.length > 1 && rows.every((row) => row[colOf(primary)] !== undefined)) {
      chart = {
        type: "bar", title: `${primary.label}${where}, ${yearText}`, unit: primary.unit, lowerIsBetter: primary.direction === "lower_is_better",
        data: rows.filter((row) => row[colOf(primary)] !== null).map((row) => ({ label: `${row.university_name}${years.length > 1 ? ` ${row.year}` : ""}`, value: Number(row[colOf(primary)]) })),
      };
    }
    if ((posCounts.size && [...posCounts.values()].some((c) => c > 1))) lines.push("(= means a shared position.)");
  }

  const foot: string[] = [...r.assumptions, ...r.notes];
  for (const m of present) {
    const missing = rows.filter((row) => row[colOf(m)] === null).map((row) => row.university_name);
    if (missing.length) foot.push(`No data for ${m.label.toLowerCase()} for ${[...new Set(missing)].join(", ")}.`);
  }
  for (const row of rows) {
    if (row.prev_rank_source === "corrected" || row.prev_rank_source === "derived") {
      const what = row.prev_rank_source === "corrected" ? "corrected from the previous year's table (the published figure was inconsistent)" : "filled in from the previous year's table (the university had been renamed)";
      foot.push(`${row.university_name}${row.year ? ` ${row.year}` : ""}: previous rank ${row.prev_rank} was ${what}, not the Guardian's own figure.`);
    }
    const other = String(row.dq_note ?? "").split("; ").filter((n) => n && !n.startsWith("prev_rank ") && !n.startsWith("source name"));
    for (const n of other) foot.push(`${row.university_name}: ${n}.`);
  }
  const uniqueFoot = [...new Set(foot)];
  const text = uniqueFoot.length ? `${lines.join("\n")}\n\n${uniqueFoot.map((f) => `_${f}_`).join("\n")}` : lines.join("\n");
  return { text, chart };
}

export function declineText(reason: string, detail?: string): string {
  const base: Record<string, string> = {
    not_in_data: "I can only answer from the Guardian league-table data (2013-2015): ranks, scores and the measures in the glossary. That isn't in the data.",
    prediction: "The data covers the 2013, 2014 and 2015 tables only. I don't make predictions.",
    opinion: "I can only report what the data says, not opinions.",
    unsafe: "I can't do that. I only run read-only questions over the league-table data.",
    guard: "I couldn't build a safe query for that question, so I didn't run anything.",
    db_error: "The query failed twice, so I'm not guessing an answer. Try rephrasing the question.",
    llm_error: "The language model didn't return a usable query, so I'm not guessing an answer.",
    bad_output: "The language model's reply didn't pass the checks, so I didn't run it.",
  };
  return detail ? `${base[reason] ?? base.not_in_data}\n\n_${detail}_` : base[reason] ?? base.not_in_data;
}
