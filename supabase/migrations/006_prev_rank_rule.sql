create or replace view clean.overall_ranking as
with base as (
  select r.*, u.university_id, u.canonical_name
  from raw.overall r
  join clean.dim_university u on r.institution = any (u.source_names)
),
published as (
  select ranking_year from raw.overall group by 1 having count(ranking_prev) > 0
),
with_prev as (
  select b.*, case when b.ranking_year in (select ranking_year from published) then p.ranking end as actual_prev_rank
  from base b
  left join base p on p.university_id = b.university_id and p.ranking_year = b.ranking_year - 1
)
select
  ranking_year                                   as year,
  university_id,
  canonical_name                                 as university_name,
  ranking                                        as rank,
  coalesce(actual_prev_rank, ranking_prev)       as prev_rank,
  coalesce(actual_prev_rank, ranking_prev) - ranking as places_climbed,
  guardian_score_100                             as guardian_score,
  nss_teaching_pct                               as nss_teaching,
  nss_overall_pct                                as nss_overall,
  expenditure_per_student_10                     as expenditure_per_student,
  student_staff_ratio,
  career_prospects_pct                           as career_prospects,
  value_added_score_10                           as value_added,
  entry_tariff,
  nss_feedback_pct                               as nss_feedback,
  nullif(concat_ws('; ',
    case when actual_prev_rank is not null and ranking_prev is not null and ranking_prev <> actual_prev_rank
         then format('prev_rank corrected: source said %s, %s table says %s', ranking_prev, ranking_year - 1, actual_prev_rank) end,
    case when actual_prev_rank is not null and ranking_prev is null
         then format('prev_rank filled from %s table (source empty)', ranking_year - 1) end,
    case when institution <> canonical_name
         then format('source name "%s"', institution) end
  ), '')                                         as dq_note,
  source_row
from with_prev;

create or replace view clean.subject_ranking as
with base as (
  select
    r.*,
    case when r.subject_area_year = 2015 and r.subject_area = 'Computer sciences and IT'
         then 'Computer Science & Information Systems' else r.subject_area end as subject_name_fixed,
    u.university_id, u.canonical_name
  from raw.subject r
  join clean.dim_university u on r.institution = any (u.source_names)
),
with_ids as (
  select b.*, s.subject_id
  from base b join clean.dim_subject s on s.name = b.subject_name_fixed
),
published as (
  select subject_id, subject_area_year from with_ids group by 1, 2 having count(subject_area_rank_prev) > 0
),
with_prev as (
  select b.*,
    case when (b.subject_id, b.subject_area_year) in (select subject_id, subject_area_year from published)
         then p.subject_area_rank end as actual_prev_rank
  from with_ids b
  left join with_ids p
    on p.university_id = b.university_id and p.subject_id = b.subject_id
   and p.subject_area_year = b.subject_area_year - 1
)
select
  subject_area_year                              as year,
  subject_id,
  subject_name_fixed                             as subject_name,
  university_id,
  canonical_name                                 as university_name,
  subject_area_rank                              as rank,
  coalesce(actual_prev_rank, subject_area_rank_prev) as prev_rank,
  coalesce(actual_prev_rank, subject_area_rank_prev) - subject_area_rank as places_climbed,
  nullif(guardian_score_100, 0)                  as guardian_score,
  nullif(pct_satisfied_with_teaching, 0)         as nss_teaching,
  nullif(pct_satisfied_overall_with_course, 0)   as nss_overall,
  nullif(expenditure_per_student_fte, 0)         as expenditure_per_student,
  nullif(student_staff_ratio, 0)                 as student_staff_ratio,
  nullif(career_prospects, 0)                    as career_prospects,
  nullif(value_added_score_10, 0)                as value_added,
  nullif(average_entry_tariff, 0)                as entry_tariff,
  nullif(pct_satisfied_with_assessment, 0)       as nss_feedback,
  nullif(concat_ws('; ',
    case when subject_name_fixed <> subject_area
         then format('relabelled from "%s" (assumed mislabelled, DQ4)', subject_area) end,
    case when actual_prev_rank is not null and subject_area_rank_prev is not null and subject_area_rank_prev <> actual_prev_rank
         then format('prev_rank corrected: source said %s, %s table says %s', subject_area_rank_prev, subject_area_year - 1, actual_prev_rank) end,
    case when actual_prev_rank is not null and subject_area_rank_prev is null
         then format('prev_rank filled from %s table (source empty, institution renamed)', subject_area_year - 1) end,
    case when career_prospects = 0 then 'career_prospects was 0 in source, set to NULL' end,
    case when average_entry_tariff = 0 then 'entry_tariff was 0 in source, set to NULL' end,
    case when institution <> canonical_name then format('source name "%s"', institution) end
  ), '')                                         as dq_note,
  source_row
from with_prev;

grant select on all tables in schema clean to chatbot_reader;
