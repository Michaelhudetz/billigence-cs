import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { adminDb } from "./db-admin";

type Row = Record<string, any>;

const OVERALL_COLUMNS: Record<string, string> = {
  "Ranking Year": "ranking_year",
  "Ranking": "ranking",
  "Ranking (Prev)": "ranking_prev",
  "Ranking Change": "ranking_change",
  "Institution": "institution",
  "Guardian score/100": "guardian_score_100",
  "NSS Teaching (%)": "nss_teaching_pct",
  "NSS Overall (%)": "nss_overall_pct",
  "Expenditure per student / 10": "expenditure_per_student_10",
  "Student:staff ratio": "student_staff_ratio",
  "Career prospects (%)": "career_prospects_pct",
  "Value added score/10": "value_added_score_10",
  "Entry Tariff": "entry_tariff",
  "NSS Feedback (%)": "nss_feedback_pct",
};
const SUBJECT_COLUMNS: Record<string, string> = {
  "Subject Area Year": "subject_area_year",
  "Subject Area": "subject_area",
  "Subject Area Rank": "subject_area_rank",
  "Subject Area Rank (Prev)": "subject_area_rank_prev",
  "Subject Area Rank Change": "subject_area_rank_change",
  "Institution": "institution",
  "Guardian score/100": "guardian_score_100",
  "% Satisfied with Teaching": "pct_satisfied_with_teaching",
  "% Satisfied overall with course": "pct_satisfied_overall_with_course",
  "Expenditure per student (FTE)": "expenditure_per_student_fte",
  "Student:staff ratio": "student_staff_ratio",
  "Career prospects": "career_prospects",
  "Value added score/10": "value_added_score_10",
  "Average Entry Tariff": "average_entry_tariff",
  "% Satisfied with Assessment": "pct_satisfied_with_assessment",
};

function readSheet(wb: XLSX.WorkBook, name: string, columns: Record<string, string>) {
  const rows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
  const unknown = Object.keys(rows[0]).filter((h) => !(h in columns));
  if (unknown.length) throw new Error(`Unexpected headers in "${name}": ${unknown.join(", ")}`);
  return rows.map((r, i) => {
    const out: Row = { source_row: i + 2 };
    for (const [header, col] of Object.entries(columns)) out[col] = r[header];
    return out;
  });
}

const wb = XLSX.read(readFileSync("data/TheGuardianRanking2.xlsx"));
const overall = readSheet(wb, "The Guardian Ranking", OVERALL_COLUMNS);
const subject = readSheet(wb, "The Guardian - Subject Areas", SUBJECT_COLUMNS);
const universities: Row[] = parse(readFileSync("seeds/dim_university.yml", "utf8"));
const subjectSeed: Row[] = parse(readFileSync("seeds/dim_subject.yml", "utf8"));

const errors: string[] = [];
const owner = new Map<string, string>();
for (const u of universities) {
  for (const n of u.source_names) {
    if (owner.has(n)) errors.push(`"${n}" is in both ${owner.get(n)} and ${u.id}`);
    owner.set(n, u.id);
  }
}
const ids = new Set(universities.map((u) => u.id));
if (ids.size !== universities.length) errors.push("duplicate university ids in seed");
for (const u of universities) for (const p of u.successor_of ?? []) if (!ids.has(p)) errors.push(`${u.id}.successor_of: unknown id ${p}`);
const dataNames = new Set([...overall, ...subject].map((r) => r.institution));
for (const n of dataNames) if (!owner.has(n)) errors.push(`source name "${n}" is not mapped in seeds/dim_university.yml`);
for (const n of owner.keys()) if (!dataNames.has(n)) errors.push(`seed source name "${n}" does not appear in the data`);
if (errors.length) { console.error("Seed validation failed:\n  " + errors.join("\n  ")); process.exit(1); }

const subjectNames = new Set(subject.map((r) => r.subject_area));
const seedNames = subjectSeed.map((x) => x.name);
for (const n of subjectNames) if (!seedNames.includes(n)) errors.push(`subject "${n}" is not in seeds/dim_subject.yml`);
for (const n of seedNames) if (!subjectNames.has(n)) errors.push(`seed subject "${n}" does not appear in the data`);
if (new Set(seedNames).size !== seedNames.length) errors.push("duplicate subject names in seed");
if (new Set(subjectSeed.map((x) => x.id)).size !== subjectSeed.length) errors.push("duplicate subject ids in seed");
if (errors.length) { console.error("Seed validation failed:\n  " + errors.join("\n  ")); process.exit(1); }
const dimSubject = subjectSeed.map((x) => ({
  subject_id: x.id, name: x.name, first_year: x.first_year, last_year: x.last_year,
  lineage_group: x.lineage_group ?? x.id, lineage_note: x.lineage_note ?? null,
}));

const sql = adminDb();
await sql.begin(async (tx) => {
  await tx`truncate raw.overall, raw.subject, clean.dim_university, clean.dim_subject`;
  for (let i = 0; i < overall.length; i += 1000) await tx`insert into raw.overall ${tx(overall.slice(i, i + 1000))}`;
  for (let i = 0; i < subject.length; i += 1000) await tx`insert into raw.subject ${tx(subject.slice(i, i + 1000))}`;
  await tx`insert into clean.dim_university ${tx(universities.map((u) => ({
    university_id: u.id, canonical_name: u.canonical_name, source_names: u.source_names,
    aliases: u.aliases ?? [], successor_of: u.successor_of ?? [],
    valid_from_year: u.valid_from_year, valid_to_year: u.valid_to_year,
  })))}`;
  await tx`insert into clean.dim_subject ${tx(dimSubject)}`;

  const badSubjects = await tx`
    select d.subject_id, d.first_year, d.last_year, y.min, y.max from clean.dim_subject d
    left join (select subject_id, min(year), max(year) from clean.subject_ranking group by 1) y using (subject_id)
    where d.first_year is distinct from y.min or d.last_year is distinct from y.max`;
  const badUnis = await tx`
    select d.university_id, d.valid_from_year, d.valid_to_year, y.min, y.max from clean.dim_university d
    left join (select university_id, min(year), max(year) from (
                 select university_id, year from clean.overall_ranking
                 union all select university_id, year from clean.subject_ranking) a group by 1) y using (university_id)
    where d.valid_from_year is distinct from y.min or d.valid_to_year is distinct from y.max`;
  if (badSubjects.length || badUnis.length) {
    console.error("Seed years don't match the data:", [...badSubjects, ...badUnis]);
    throw new Error("seed year mismatch, nothing loaded");
  }
});

const [c] = await sql`
  select (select count(*) from raw.overall) as raw_overall, (select count(*) from raw.subject) as raw_subject,
         (select count(*) from clean.overall_ranking) as clean_overall, (select count(*) from clean.subject_ranking) as clean_subject,
         (select count(*) from clean.dim_university) as universities, (select count(*) from clean.dim_subject) as subjects`;
console.log(c);
await sql.end();
