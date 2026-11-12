-- Run by db/test/run.sh after every migration has been applied to a fresh
-- database. psql variable :files = how many migration files there are.
select set_config('elliot.migration_files', :'files', false);
do $$
declare
  n_files int := current_setting('elliot.migration_files')::int;
  n int;
  r record;
begin
  -- Every migration file is in migration_status(), and every one is present.
  select count(*) into n from migration_status();
  if n <> n_files then
    raise exception 'migration_status() lists % migrations, the folder has %. A migration from 0049 on must start with select begin_migration(...).', n, n_files;
  end if;
  for r in select * from migration_status() where not in_database or note like 'MISSING%' loop
    raise exception 'migration_status() says % (%) is not in the database: %', r.version, r.name, coalesce(r.note, '');
  end loop;
  -- Recorded: found by 0049, or ran with begin_migration.
  select count(*) into n from schema_migrations;
  if n <> n_files then raise exception 'schema_migrations has % rows, expected %', n, n_files; end if;
  if exists (select 1 from schema_migrations where version >= '0049' and how <> 'ran') then
    raise exception 'a migration from 0049 on was not recorded by begin_migration';
  end if;
  -- Nobody but the database owner can see or change it.
  if has_table_privilege('anon', 'schema_migrations', 'select') or has_table_privilege('authenticated', 'schema_migrations', 'select')
     or has_function_privilege('authenticated', 'begin_migration(text,text,text)', 'execute')
     or has_function_privilege('anon', 'migration_status()', 'execute') then
    raise exception 'the migration record is reachable from the Supabase API';
  end if;
end $$;
select 'migration record checks passed';
