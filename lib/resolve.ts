import Fuse from "fuse.js";
import { loadSemantic, type Metric, type Subject, type University } from "./semantic";

export const YEARS = [2013, 2014, 2015];
export const DEFAULT_YEAR = 2015;

export type ResolvedUniversity = { id: string; name: string; matched: string; how: string };
export type ResolvedSubject = { id: string; name: string; matched: string; how: string };
export type Resolved = {
  years: number[];
  yearSource: "question" | "selector" | "default";
  unsupportedYears: number[];
  universities: ResolvedUniversity[];
  groups: { id: string; name: string; members: string[] }[];
  subjects: ResolvedSubject[];
  metrics: Metric[];
  metricSource: "question" | "selector" | "none";
  assumptions: string[];
  notes: string[];
  kgRules: string[];
  clarification: { text: string; candidates: string[]; matched: string } | null;
};

type Phrase = { text: string; kind: "university" | "group" | "subject" | "metric"; ids: string[] };

const COMMON_WORD_NAMES = new Set(["city", "reading", "bath", "worcester"]);
const STOPWORDS = new Set(("which what who whom how did does do is are was were the a an of in for to and or vs versus " +
  "between with by on at best worst top bottom highest lowest most least rank ranks ranked ranking rankings university " +
  "universities uni unis year years table compare comparison show me give list than better worse score scores 2nd 3rd 1st " +
  "place position first last second third fourth fifth improved improve dropped mean means meaning explain define tell about please data guardian").split(" "));

let phrases: Phrase[] | null = null;
let fuse: Fuse<{ name: string; id: string }> | null = null;

const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/'s\b/g, "").replace(/[^a-z0-9&'\- ]+/g, " ").replace(/\s+/g, " ").trim();

function buildPhrases(): Phrase[] {
  const s = loadSemantic();
  const out: Phrase[] = [];
  for (const u of s.universities) {
    for (const n of new Set([u.canonical_name, ...u.source_names, ...u.aliases])) out.push({ text: norm(n), kind: "university", ids: [u.id] });
  }
  for (const g of s.kg.groups) for (const a of g.aliases) out.push({ text: norm(a), kind: "group", ids: [g.id] });
  for (const x of s.subjects) out.push({ text: norm(x.name), kind: "subject", ids: [x.id] });
  for (const sa of s.kg.subject_aliases) for (const a of sa.aliases) out.push({ text: norm(a), kind: "subject", ids: sa.subject_ids });
  for (const m of s.layer.metrics) for (const w of [m.id.replace(/_/g, " "), m.label]) out.push({ text: norm(w), kind: "metric", ids: [m.id] });
  for (const [word, target] of Object.entries(s.layer.synonyms)) {
    if (s.metricById.has(target)) out.push({ text: norm(word), kind: "metric", ids: [target] });
  }
  return out.filter((p) => p.text).sort((a, b) => b.text.length - a.text.length || b.ids.length - a.ids.length);
}

function uniFuse() {
  const s = loadSemantic();
  const items = s.universities.flatMap((u) => [u.canonical_name, ...u.source_names, ...u.aliases].map((name) => ({ name: norm(name), id: u.id })));
  return new Fuse(items, { keys: ["name"], includeScore: true, threshold: 0.25, ignoreLocation: true, minMatchCharLength: 4 });
}

export function resolve(question: string, context: { year?: number; metricId?: string } = {}): Resolved {
  const s = loadSemantic();
  phrases ??= buildPhrases();
  fuse ??= uniFuse();
  const uniById = new Map(s.universities.map((u) => [u.id, u]));
  const subjectById = new Map(s.subjects.map((x) => [x.id, x]));

  const r: Resolved = {
    years: [], yearSource: "default", unsupportedYears: [], universities: [], groups: [], subjects: [], metrics: [],
    metricSource: "none", assumptions: [], notes: [], kgRules: [], clarification: null,
  };

  const yearsInText = [...question.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  r.years = [...new Set(yearsInText.filter((y) => YEARS.includes(y)))].sort();
  r.unsupportedYears = [...new Set(yearsInText.filter((y) => !YEARS.includes(y)))];
  if (r.years.length === 2 && /\b(from|between)\b.*\b(to|and|until)\b|\d{4}\s*[-–]\s*\d{4}/i.test(question)) {
    r.years = YEARS.filter((y) => y >= r.years[0] && y <= r.years[1]);
  }
  if (r.years.length) r.yearSource = "question";
  else if (context.year && YEARS.includes(context.year)) { r.years = [context.year]; r.yearSource = "selector"; r.assumptions.push(`Year not in the question, using the selected year ${context.year}.`); }
  else { r.years = [DEFAULT_YEAR]; r.assumptions.push(`Year not specified, showing ${DEFAULT_YEAR} (the latest year in the data).`); }

  let text = ` ${norm(question).replace(/\b(19|20)\d{2}\b/g, " ")} `;
  const original = ` ${question.replace(/[’`]/g, "'")} `;
  const found: { phrase: Phrase; matched: string }[] = [];
  for (const p of phrases) {
    const re = new RegExp(`(?<=[ ])${p.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?=[ ])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (p.kind === "university" && COMMON_WORD_NAMES.has(p.text)) {
        const cap = p.text[0].toUpperCase() + p.text.slice(1);
        if (!new RegExp(`\\b${cap}\\b`).test(original)) continue;
      }
      found.push({ phrase: p, matched: m[0] });
      text = text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length);
    }
  }

  for (const { phrase: p, matched } of found) {
    if (p.kind === "university") addUni(r, uniById.get(p.ids[0])!, matched, "exact name or alias");
    if (p.kind === "group") {
      const g = s.kg.groups.find((x) => x.id === p.ids[0])!;
      if (!r.groups.some((x) => x.id === g.id)) {
        r.groups.push({ id: g.id, name: g.name, members: g.members });
        r.kgRules.push(`group "${g.name}" -> ${g.members.length} universities (${g.members.join(", ")})`);
        for (const id of g.members) addUni(r, uniById.get(id)!, matched, `member of ${g.name}`);
      }
    }
    if (p.kind === "subject") addSubject(r, p.ids, matched, subjectById);
    if (p.kind === "metric") {
      const m = s.metricById.get(p.ids[0])!;
      if (!r.metrics.includes(m)) r.metrics.push(m);
    }
  }

  if (r.groups.length >= 2) {
    const both = r.groups.map((g) => new Set(g.members)).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    r.universities = r.universities.filter((u) => !u.how.startsWith("member of ") || both.has(u.id));
    r.kgRules.push(`groups combined as intersection (${r.groups.map((g) => g.name).join(" AND ")}) -> ${[...both].join(", ") || "none"}`);
    if (!both.size) r.notes.push(`No university is in all of: ${r.groups.map((g) => g.name).join(", ")}.`);
  }

  const leftover = text.split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !COMMON_WORD_NAMES.has(w));
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= leftover.length; i++) {
      const gram = leftover.slice(i, i + n).join(" ");
      const hits = fuse.search(gram).filter((h) => (h.score ?? 1) <= 0.25 && Math.abs(h.item.name.length - gram.length) <= Math.max(2, 0.3 * h.item.name.length));
      if (!hits.length) continue;
      const best = hits[0];
      const rival = hits.find((h) => h.item.id !== best.item.id && (h.score ?? 1) - (best.score ?? 0) < 0.05);
      if (rival) {
        const names = [best.item.id, rival.item.id].map((id) => uniById.get(id)!.canonical_name);
        r.clarification = { text: `Did you mean ${names.join(" or ")}?`, candidates: names, matched: gram };
        return r;
      }
      addUni(r, uniById.get(best.item.id)!, gram, `fuzzy match (score ${(best.score ?? 0).toFixed(2)})`);
      leftover.splice(i, n);
      i--;
    }
  }

  const nonRank = r.metrics.filter((m) => m.id !== "rank");
  if (nonRank.length) { r.metrics = r.metrics; r.metricSource = "question"; }
  else if (context.metricId && s.metricById.has(context.metricId)) {
    r.metrics = [s.metricById.get(context.metricId)!];
    r.metricSource = "selector";
    r.assumptions.push(`No measure named in the question, using the selected one: ${r.metrics[0].label}.`);
  } else if (r.metrics.length) r.metricSource = "question";

  for (const u of [...r.universities]) {
    const uni = uniById.get(u.id)!;
    const missing = r.years.filter((y) => y < uni.valid_from_year || y > uni.valid_to_year);
    if (!missing.length) continue;
    const before = s.kg.university_lineage.filter((e) => e.to === uni.id && missing.some((y) => y < uni.valid_from_year));
    const after = s.kg.university_lineage.filter((e) => e.from === uni.id && missing.some((y) => y > uni.valid_to_year));
    for (const e of before) addUni(r, uniById.get(e.from)!, u.matched, `predecessor of ${uni.canonical_name}`);
    for (const e of after) addUni(r, uniById.get(e.to)!, u.matched, `successor of ${uni.canonical_name}`);
    const edges = [...before, ...after];
    if (edges.length) {
      u.how += `; has no rows in ${missing.join(", ")}, use its ${before.length ? "predecessors" : "successors"} listed here`;
      r.kgRules.push(`lineage: ${uni.canonical_name} in ${missing.join(", ")} -> ${edges.map((e) => (e.to === uni.id ? e.from : e.to)).join(", ")}`);
      r.notes.push(`${uni.canonical_name} doesn't appear in ${missing.join(" or ")}. ${edges[0].note}`);
    } else {
      r.notes.push(`${uni.canonical_name} appears in the data only for ${yearSpan(uni)}.`);
    }
  }
  return r;
}

function addUni(r: Resolved, u: University, matched: string, how: string) {
  if (!r.universities.some((x) => x.id === u.id)) r.universities.push({ id: u.id, name: u.canonical_name, matched: matched.trim(), how });
}

function addSubject(r: Resolved, ids: string[], matched: string, byId: Map<string, Subject>) {
  const s = loadSemantic();
  const valid = ids.filter((id) => r.years.some((y) => y >= byId.get(id)!.first_year && y <= byId.get(id)!.last_year));
  const push = (id: string, how: string) => { if (!r.subjects.some((x) => x.id === id)) r.subjects.push({ id, name: byId.get(id)!.name, matched: matched.trim(), how }); };
  if (valid.length) {
    for (const id of valid) push(id, ids.length > 1 ? `alias, subject name used in ${r.years.join("/")}` : "exact name or alias");
    if (ids.length > 1) r.kgRules.push(`subject alias "${matched.trim()}" (${r.years.join(", ")}) -> ${valid.join(", ")}`);
    for (const id of valid) {
      const subj = byId.get(id)!;
      if (!subj.lineage_note) continue;
      r.kgRules.push(`subject note (${subj.name}): ${subj.lineage_note}`);
      if (r.years.length > 1) r.notes.push(`${subj.name}: ${subj.lineage_note}`);
    }
    return;
  }
  const id = ids[0];
  const subj = byId.get(id)!;
  const forward = s.kg.subject_lineage.filter((e) => e.from === id).map((e) => e.to);
  const backward = s.kg.subject_lineage.filter((e) => e.to === id).map((e) => e.from);
  const candidates = [...forward, ...backward].filter((c) => r.years.some((y) => y >= byId.get(c)!.first_year && y <= byId.get(c)!.last_year));
  if (candidates.length === 1) {
    push(candidates[0], `lineage of ${subj.name}`);
    r.kgRules.push(`subject lineage: ${subj.name} in ${r.years.join(", ")} -> ${byId.get(candidates[0])!.name}`);
    r.notes.push(`${subj.name} isn't in the ${r.years.join("/")} tables; showing ${byId.get(candidates[0])!.name} instead. ${subj.lineage_note ?? ""}`.trim());
  } else if (candidates.length > 1) {
    const names = candidates.map((c) => byId.get(c)!.name);
    r.clarification = { text: `${subj.name} was split in ${r.years.join("/")}. Which part do you mean: ${names.join(", ")}?`, candidates: names, matched: matched.trim() };
  } else {
    r.notes.push(`${subj.name} only exists in ${subj.first_year === subj.last_year ? subj.first_year : `${subj.first_year}-${subj.last_year}`}.`);
    push(id, "exact name (outside its years)");
  }
}

const yearSpan = (u: University) => (u.valid_from_year === u.valid_to_year ? `${u.valid_from_year}` : `${u.valid_from_year}-${u.valid_to_year}`);
