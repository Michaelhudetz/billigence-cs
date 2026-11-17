do $$ begin
  if not exists (select from pg_roles where rolname = 'chatbot_reader') then create role chatbot_reader login; end if;
  if not exists (select from pg_roles where rolname = 'chatbot_logger') then create role chatbot_logger login; end if;
end $$;

revoke all on schema raw, ops from chatbot_reader;
revoke all on all tables in schema raw, ops from chatbot_reader;
grant usage on schema clean to chatbot_reader;
grant select on all tables in schema clean to chatbot_reader;
alter role chatbot_reader set statement_timeout = '3s';
alter role chatbot_reader set default_transaction_read_only = on;

revoke all on schema raw, clean from chatbot_logger;
grant usage on schema ops to chatbot_logger;
grant insert on ops.query_log to chatbot_logger;
alter role chatbot_logger set statement_timeout = '3s';
