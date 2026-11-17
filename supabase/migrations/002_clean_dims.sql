create table if not exists clean.dim_university (
  university_id    text primary key,
  canonical_name   text not null unique,
  source_names     text[] not null,
  aliases          text[] not null default '{}',
  successor_of     text[] not null default '{}',
  valid_from_year  int,
  valid_to_year    int
);

create table if not exists clean.dim_subject (
  subject_id     text primary key,
  name           text not null unique,
  first_year     int,
  last_year      int,
  lineage_group  text not null,
  lineage_note   text
);
