create schema if not exists raw;
create schema if not exists clean;
create schema if not exists ops;

create table if not exists raw.overall (
  source_row                  int primary key,
  ranking_year                int not null,
  ranking                     int not null,
  ranking_prev                int,
  ranking_change              int,
  institution                 text not null,
  guardian_score_100          numeric,
  nss_teaching_pct            numeric,
  nss_overall_pct             numeric,
  expenditure_per_student_10  numeric,
  student_staff_ratio         numeric,
  career_prospects_pct        numeric,
  value_added_score_10        numeric,
  entry_tariff                numeric,
  nss_feedback_pct            numeric
);

create table if not exists raw.subject (
  source_row                      int primary key,
  subject_area_year               int not null,
  subject_area                    text not null,
  subject_area_rank               int not null,
  subject_area_rank_prev          int,
  subject_area_rank_change        int,
  institution                     text not null,
  guardian_score_100              numeric,
  pct_satisfied_with_teaching     numeric,
  pct_satisfied_overall_with_course numeric,
  expenditure_per_student_fte     numeric,
  student_staff_ratio             numeric,
  career_prospects                numeric,
  value_added_score_10            numeric,
  average_entry_tariff            numeric,
  pct_satisfied_with_assessment   numeric
);
