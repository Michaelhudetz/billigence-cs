create table if not exists ops.query_log (
  id                 uuid primary key default gen_random_uuid(),
  ts                 timestamptz not null default now(),
  question           text not null,
  resolved_entities  jsonb,
  provider           text,
  model              text,
  sql                text,
  guard_result       jsonb,
  row_count          int,
  latency_ms         int,
  tokens_in          int,
  tokens_out         int,
  cost_usd           numeric(10, 6),
  outcome            text
);
