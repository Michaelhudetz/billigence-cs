import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

export type Direction = "higher_is_better" | "lower_is_better";
export type Entity = { id: string; description: string; key: string; views: string[] };
export type Dimension = { id: string; column: string; type: string; views: string[]; description: string };
export type Metric = {
  id: string; label: string; description: string; unit: string; scale: string; direction: Direction;
  null_caveat: string | null; needs_review: boolean;
  columns: Record<string, string>;
};
export type Join = { from: string; to: string; on: string[]; description: string };
export type ExampleQuery = { id: string; question: string; sql: string };
export type SemanticLayer = {
  entities: Entity[]; dimensions: Dimension[]; metrics: Metric[]; joins: Join[];
  synonyms: Record<string, string>;
  example_queries: ExampleQuery[];
};
export type Group = { id: string; name: string; aliases: string[]; members: string[]; source: string };
export type KnowledgeGraph = {
  groups: Group[];
  subject_aliases: { aliases: string[]; subject_ids: string[]; source: string }[];
  university_lineage: { from: string; to: string; type: string; data_year: number; note: string; source: string }[];
  subject_lineage: { from: string; to: string; type: string; year: number; source: string; approximate?: boolean }[];
};
export type University = {
  id: string; canonical_name: string; source_names: string[]; aliases: string[];
  successor_of?: string[]; valid_from_year: number; valid_to_year: number;
};
export type Subject = { id: string; name: string; first_year: number; last_year: number; lineage_group?: string; lineage_note?: string };

export type Semantic = {
  layer: SemanticLayer; kg: KnowledgeGraph; universities: University[]; subjects: Subject[];
  metricById: Map<string, Metric>;
  columnsByView: Map<string, Set<string>>;
  viewKeys: Map<string, string[]>;
};

const readYaml = (fullPath: string) => parse(readFileSync(fullPath, "utf8"));

export function validate(s: Omit<Semantic, "metricById" | "columnsByView" | "viewKeys">): string[] {
  const errors: string[] = [];
  const { layer, kg, universities, subjects } = s;
  const lc = (x: string) => x.trim().toLowerCase();
  const views = columnsByView(layer);

  const ids = new Set<string>();
  for (const x of [...layer.dimensions, ...layer.metrics]) {
    if (ids.has(x.id)) errors.push(`id "${x.id}" defined twice (dimensions and metrics share one id space)`);
    ids.add(x.id);
  }
  for (const v of views.keys()) if (!v.startsWith("clean.")) errors.push(`view "${v}" is not in schema clean`);

  for (const m of layer.metrics) {
    for (const f of ["label", "description", "unit", "scale", "direction"] as const) if (!m[f]) errors.push(`metric "${m.id}": missing ${f}`);
    if (m.null_caveat === undefined) errors.push(`metric "${m.id}": missing null_caveat (use null if none)`);
    if (typeof m.needs_review !== "boolean") errors.push(`metric "${m.id}": needs_review must be true or false`);
    if (!["higher_is_better", "lower_is_better"].includes(m.direction)) errors.push(`metric "${m.id}": bad direction "${m.direction}"`);
    if (!m.columns || !Object.keys(m.columns).length) errors.push(`metric "${m.id}": no columns`);
  }
  for (const d of layer.dimensions) if (!d.views?.length) errors.push(`dimension "${d.id}": no views`);

  for (const e of layer.entities) for (const v of e.views) {
    if (!views.get(v)?.has(e.key)) errors.push(`entity "${e.id}": key "${e.key}" is not a column of ${v}`);
  }

  for (const j of layer.joins) for (const c of j.on) for (const v of [j.from, j.to]) {
    if (!views.get(v)?.has(c)) errors.push(`join ${j.from} -> ${j.to}: "${c}" is not a column of ${v}`);
  }

  const wordOwner = new Map<string, string>();
  for (const x of [...layer.dimensions, ...layer.metrics]) {
    for (const w of [x.id.replace(/_/g, " "), ...("label" in x ? [x.label] : [])].map(lc)) {
      if (wordOwner.has(w) && wordOwner.get(w) !== x.id) errors.push(`"${w}" names both ${wordOwner.get(w)} and ${x.id}`);
      wordOwner.set(w, x.id);
    }
  }
  for (const [word, target] of Object.entries(layer.synonyms)) {
    if (!ids.has(target)) errors.push(`synonym "${word}" points at unknown id "${target}"`);
    const owner = wordOwner.get(lc(word));
    if (owner && owner !== target) errors.push(`synonym "${word}" -> ${target}, but "${word}" already names ${owner}`);
    wordOwner.set(lc(word), target);
  }

  for (const q of layer.example_queries) {
    const refs = [...q.sql.matchAll(/\b(?:from|join)\s+([a-z_]+\.[a-z_]+)/gi)].map((r) => r[1]);
    if (!refs.length) errors.push(`example query ${q.id}: no view found`);
    for (const r of refs) if (!views.has(r)) errors.push(`example query ${q.id}: uses ${r}`);
  }

  const uniIds = new Set(universities.map((u) => u.id));
  const subjectIds = new Set(subjects.map((x) => x.id));
  if (uniIds.size !== universities.length) errors.push("duplicate university id in seed");
  if (subjectIds.size !== subjects.length) errors.push("duplicate subject id in seed");
  const nameOwner = new Map<string, string>();
  for (const u of universities) for (const n of new Set([u.canonical_name, ...u.source_names, ...u.aliases].map(lc))) {
    const owner = nameOwner.get(n);
    if (owner && owner !== u.id) errors.push(`university name/alias "${n}" used by both ${owner} and ${u.id}`);
    nameOwner.set(n, u.id);
  }

  const kgAliasOwner = new Map<string, string>();
  const claim = (alias: string, owner: string) => {
    const a = lc(alias);
    const prev = kgAliasOwner.get(a);
    if (prev && prev !== owner) errors.push(`KG alias "${a}" used by both ${prev} and ${owner}`);
    if (nameOwner.has(a)) errors.push(`KG alias "${a}" is also a university name (${nameOwner.get(a)})`);
    kgAliasOwner.set(a, owner);
  };
  for (const g of kg.groups) {
    if (!g.source) errors.push(`group ${g.id}: missing source`);
    for (const m of g.members) if (!uniIds.has(m)) errors.push(`group ${g.id}: unknown university "${m}"`);
    if (new Set(g.members).size !== g.members.length) errors.push(`group ${g.id}: duplicate member`);
    for (const a of g.aliases) claim(a, `group:${g.id}`);
  }
  for (const sa of kg.subject_aliases) {
    if (!sa.source) errors.push(`subject alias ${sa.aliases[0]}: missing source`);
    for (const id of sa.subject_ids) if (!subjectIds.has(id)) errors.push(`subject alias "${sa.aliases[0]}": unknown subject "${id}"`);
    for (const a of sa.aliases) claim(a, `subject:${sa.subject_ids.join("|")}`);
  }
  const uniById = new Map(universities.map((u) => [u.id, u]));
  for (const e of kg.university_lineage) {
    if (!e.source) errors.push(`university lineage ${e.from}->${e.to}: missing source`);
    if (!uniIds.has(e.from) || !uniIds.has(e.to)) { errors.push(`university lineage ${e.from}->${e.to}: unknown id`); continue; }
    if (!(uniById.get(e.to)!.successor_of ?? []).includes(e.from)) errors.push(`university lineage ${e.from}->${e.to}: seed successor_of disagrees`);
  }
  for (const u of universities) for (const p of u.successor_of ?? []) {
    if (!kg.university_lineage.some((e) => e.from === p && e.to === u.id)) errors.push(`seed: ${u.id}.successor_of ${p} has no KG lineage edge`);
  }
  const subjectById = new Map(subjects.map((x) => [x.id, x]));
  for (const e of kg.subject_lineage) {
    if (!e.source) errors.push(`subject lineage ${e.from}->${e.to}: missing source`);
    const a = subjectById.get(e.from), b = subjectById.get(e.to);
    if (!a || !b) { errors.push(`subject lineage ${e.from}->${e.to}: unknown id`); continue; }
    if ((a.lineage_group ?? a.id) !== (b.lineage_group ?? b.id)) errors.push(`subject lineage ${e.from}->${e.to}: different lineage_group in seed`);
    if (a.last_year >= b.first_year && e.type !== "split_out") errors.push(`subject lineage ${e.from}->${e.to}: years overlap`);
  }
  return errors;
}

function columnsByView(layer: SemanticLayer) {
  const m = new Map<string, Set<string>>();
  const add = (view: string, col: string) => { if (!m.has(view)) m.set(view, new Set()); m.get(view)!.add(col); };
  for (const d of layer.dimensions) for (const v of d.views) add(v, d.column);
  for (const x of layer.metrics) for (const [v, c] of Object.entries(x.columns)) add(v, c);
  return m;
}

function viewKeys(layer: SemanticLayer) {
  const m = new Map<string, string[]>();
  for (const e of layer.entities) for (const v of e.views) m.set(v, [...(m.get(v) ?? []), e.key]);
  return m;
}

let cached: Semantic | null = null;

export function loadSemantic(): Semantic {
  if (cached) return cached;
  const base = {
    layer: readYaml(path.join(process.cwd(), "semantic", "semantic_layer.yml")) as SemanticLayer,
    kg: readYaml(path.join(process.cwd(), "semantic", "knowledge_graph.yml")) as KnowledgeGraph,
    universities: readYaml(path.join(process.cwd(), "seeds", "dim_university.yml")) as University[],
    subjects: readYaml(path.join(process.cwd(), "seeds", "dim_subject.yml")) as Subject[],
  };
  for (const u of base.universities) u.aliases ??= [];
  const errors = validate(base);
  if (errors.length) throw new Error(`Semantic layer / KG invalid:\n  ${errors.join("\n  ")}`);
  cached = {
    ...base,
    metricById: new Map(base.layer.metrics.map((m) => [m.id, m])),
    columnsByView: columnsByView(base.layer),
    viewKeys: viewKeys(base.layer),
  };
  return cached;
}
