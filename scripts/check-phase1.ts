import postgres from "postgres";
import { adminDb } from "./db-admin";

const admin = adminDb();
const reader = postgres(process.env.DATABASE_URL_READER!, { prepare: false, onnotice: () => {} });
const logger = postgres(process.env.DATABASE_URL_LOGGER!, { prepare: false, onnotice: () => {} });

let failures = 0;
async function expect(label: string, db: postgres.Sql, query: string, shouldWork: boolean) {
  try {
    const rows = await db.unsafe(query);
    const ok = shouldWork;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label} -> ran${rows.length ? `: ${JSON.stringify(rows[0])}` : ""}`);
  } catch (e: any) {
    const ok = !shouldWork;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label} -> error: ${e.message}`);
  }
}
const show = (title: string, rows: any[]) => { console.log(`\n-- ${title}`); console.table(rows); };

console.log("== Reader role ==");
await expect("reader can SELECT clean.overall_ranking", reader, "select count(*) from clean.overall_ranking", true);
await expect("reader can SELECT clean.subject_ranking", reader, "select count(*) from clean.subject_ranking", true);
await expect("reader statement_timeout", reader, "show statement_timeout", true);
await expect("reader INSERT into clean.dim_subject", reader, "insert into clean.dim_subject (subject_id, name, lineage_group) values ('x','x','x')", false);
await expect("reader DROP VIEW", reader, "drop view clean.overall_ranking", false);
await expect("reader SELECT raw.overall", reader, "select * from raw.overall limit 1", false);
await expect("reader SELECT ops.query_log", reader, "select * from ops.query_log limit 1", false);
await expect("reader CREATE TABLE in public", reader, "create table public.x (a int)", false);
async function expectRW(label: string, query: string) {
  try { await reader.begin("read write", (tx) => tx.unsafe(query)); failures++; console.log(`FAIL ${label} -> ran`); }
  catch (e: any) { console.log(`PASS ${label} -> error: ${e.message}`); }
}
await expectRW("reader INSERT in READ WRITE transaction", "insert into clean.dim_subject (subject_id, name, lineage_group) values ('x','x','x')");
await expectRW("reader DROP VIEW in READ WRITE transaction", "drop view clean.overall_ranking");
await expectRW("reader CREATE TABLE in public in READ WRITE transaction", "create table public.x (a int)");
await expectRW("reader CREATE SCHEMA in READ WRITE transaction", "create schema evil");
await expect("reader pg_sleep(5) is killed by the 3s timeout", reader, "select pg_sleep(5)", false);

console.log("\n== Logger role ==");
await expect("logger INSERT into ops.query_log", logger, "insert into ops.query_log (question, outcome) values ('phase1 gate test', 'test')", true);
await expect("logger SELECT ops.query_log", logger, "select * from ops.query_log", false);
await expect("logger SELECT clean.overall_ranking", logger, "select * from clean.overall_ranking limit 1", false);
await admin`delete from ops.query_log where outcome = 'test'`;

console.log("\n== Row counts (raw vs clean, nothing lost or duplicated by joins) ==");
console.table(await admin`
  select (select count(*) from raw.overall) raw_overall, (select count(*) from clean.overall_ranking) clean_overall,
         (select count(*) from raw.subject) raw_subject, (select count(*) from clean.subject_ranking) clean_subject,
         (select count(*) from clean.dim_university) universities, (select count(*) from clean.dim_subject) subjects`);

console.log("\n== DQ1: places_climbed = prev_rank - rank (positive = improved) ==");
show("5 overall rows: raw change vs clean places_climbed", await admin`
  select c.year, c.university_name, c.rank, c.prev_rank, r.ranking_change as raw_change, c.places_climbed
  from clean.overall_ranking c join raw.overall r using (source_row)
  where c.year = 2015 order by c.places_climbed desc nulls last limit 5`);
show("rows where places_climbed <> -raw_change (should be only DQ2 fixes)", await admin`
  select c.year, c.university_name, r.ranking_change raw_change, c.places_climbed, c.dq_note
  from clean.overall_ranking c join raw.overall r using (source_row)
  where c.places_climbed is distinct from -r.ranking_change`);

console.log("\n== DQ2: corrected or derived prev_rank ==");
show("overall rows with corrected or derived prev_rank", await admin`
  select year, university_name, rank, prev_rank, dq_note from clean.overall_ranking where dq_note like '%prev_rank%'`);
show("subject rows with corrected or derived prev_rank (count by kind)", await admin`
  select year, case when dq_note like '%prev_rank corrected%' then 'corrected' else 'derived' end as kind, count(*)
  from clean.subject_ranking where dq_note like '%prev_rank%' group by 1, 2 order by 1, 2`);
show("subject rows with corrected or derived prev_rank (sample of 5)", await admin`
  select year, subject_name, university_name, rank, prev_rank, dq_note from clean.subject_ranking
  where dq_note like '%prev_rank%' limit 5`);

console.log("\n== DQ4: Computer Science relabel ==");
show("relabelled rows", await admin`
  select year, subject_name, university_name, rank, guardian_score, dq_note from clean.subject_ranking where dq_note like '%relabelled%'`);
show("rank collisions in 2015 CS&IS after relabel (rank shared by 2+ rows)", await admin`
  select rank, array_agg(university_name order by university_name) universities, array_agg(guardian_score order by university_name) scores
  from clean.subject_ranking where year = 2015 and subject_id = 'computer_science_and_information_systems'
  group by rank having count(*) > 1 order by rank`);

console.log("\n== DQ5: institution mapping ==");
show("5 rows where the source spelling differs from the canonical name", await admin`
  select year, university_name, dq_note from clean.subject_ranking where dq_note like '%source name%'
  order by university_name, year limit 5`);
show("institutions with more than one source spelling or a merger", await admin`
  select university_id, canonical_name, source_names, successor_of, valid_from_year, valid_to_year
  from clean.dim_university where cardinality(source_names) > 1 or cardinality(successor_of) > 0 order by 1`);

console.log("\n== DQ9: zeros and nulls ==");
show("zero -> NULL rows", await admin`
  select year, subject_name, university_name, career_prospects, entry_tariff, dq_note from clean.subject_ranking
  where dq_note like '%was 0%'`);
show("null counts in clean.subject_ranking", await admin`
  select count(*) filter (where career_prospects is null) career_prospects, count(*) filter (where value_added is null) value_added,
         count(*) filter (where expenditure_per_student is null) expenditure, count(*) filter (where entry_tariff is null) entry_tariff
  from clean.subject_ranking`);
show("null cells in clean.overall_ranking", await admin`
  select year, university_name, nss_teaching, nss_overall, expenditure_per_student, value_added, nss_feedback
  from clean.overall_ranking
  where nss_teaching is null or nss_overall is null or expenditure_per_student is null or value_added is null or nss_feedback is null`);

console.log("\n== DQ3 / DQ11: subject lineage ==");
show("dim_subject lineage groups", await admin`
  select lineage_group, subject_id, first_year, last_year from clean.dim_subject
  where lineage_group <> subject_id or lineage_note is not null order by lineage_group, first_year, subject_id`);

console.log("\n== prev_rank_source: every previous rank is traceable ==");
show("count by view, year and source", await admin`
  select 'overall' as view, year, prev_rank_source, count(*) from clean.overall_ranking group by 1, 2, 3
  union all
  select 'subject', year, prev_rank_source, count(*) from clean.subject_ranking group by 1, 2, 3
  order by 1, 2, 3`);

async function mustBeZero(label: string, rows: any[]) {
  const n = Number(rows[0].n);
  if (n !== 0) failures++;
  console.log(`${n === 0 ? "PASS" : "FAIL"} ${label}: ${n}`);
}
await mustBeZero("derived/corrected rows whose subject did not exist under the same id last year", await admin`
  select count(*) n from clean.subject_ranking s
  where s.prev_rank_source in ('derived', 'corrected')
    and not exists (select 1 from clean.subject_ranking p
                    where p.subject_id = s.subject_id and p.university_id = s.university_id and p.year = s.year - 1)`);
await mustBeZero("derived/corrected rows in subjects that start in 2015 (CS&IS, Art, History, ...)", await admin`
  select count(*) n from clean.subject_ranking s join clean.dim_subject d using (subject_id)
  where d.first_year = 2015 and s.prev_rank_source in ('derived', 'corrected')`);
await mustBeZero("derived rows where the institution kept its name (only renames may be filled)", await admin`
  select count(*) n from (
    select s.prev_rank_source, r.institution, p.institution prev_name
    from clean.subject_ranking s join raw.subject r using (source_row)
    join clean.subject_ranking ps on ps.university_id = s.university_id and ps.subject_id = s.subject_id and ps.year = s.year - 1
    join raw.subject p on p.source_row = ps.source_row
    where s.prev_rank_source = 'derived') x
  where institution = prev_name`);
await mustBeZero("non-NULL prev_rank in the 5 DQ12 subjects in 2015", await admin`
  select count(*) n from clean.subject_ranking
  where year = 2015 and prev_rank is not null and subject_id in
    ('drama_and_dance','earth_and_marine_sciences','engineering_electronic_and_electrical','engineering_materials_and_mineral','social_policy_and_administration')`);
await mustBeZero("rows with prev_rank but no prev_rank_source (or the reverse)", await admin`
  select count(*) n from (select prev_rank, prev_rank_source from clean.overall_ranking union all
                          select prev_rank, prev_rank_source from clean.subject_ranking) x
  where (prev_rank is null) <> (prev_rank_source is null)`);
show("2015 Computer Science & Information Systems: where do its prev ranks come from?", await admin`
  select prev_rank_source, count(*), count(prev_rank) with_prev_rank from clean.subject_ranking
  where year = 2015 and subject_id = 'computer_science_and_information_systems' group by 1`);
show("subjects that start in 2015: prev_rank_source", await admin`
  select s.subject_name, s.prev_rank_source, count(*) from clean.subject_ranking s join clean.dim_subject d using (subject_id)
  where d.first_year = 2015 group by 1, 2 order by 1, 2`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await Promise.all([admin.end(), reader.end(), logger.end()]);
process.exit(failures ? 1 : 0);
