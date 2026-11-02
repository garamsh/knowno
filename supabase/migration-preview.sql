-- Functions of the migration preview (scripts/migration-preview.sh), created in its own schema on
-- the preview's throwaway stack only: snapshot() records the columns and rows of every table in
-- public, private and storage, and report() compares the database with that record.
create schema migration_preview;

create table migration_preview.columns (tbl text, col text, def text);
create table migration_preview.keys (tbl text, cols text[]);
create table migration_preview.rows (tbl text, val jsonb);

-- Every table the preview compares, by its qualified name.
create function migration_preview.tables() returns table (tbl text)
language sql stable as $$
  select format('%I.%I', n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'storage')
$$;

-- Each column of those tables as its type, nullability and default.
create function migration_preview.columns_now() returns table (tbl text, col text, def text)
language sql stable as $$
  select t.tbl, a.attname::text,
    format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' not null' else '' end
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
  from migration_preview.tables() t
  join pg_attribute a on a.attrelid = t.tbl::regclass and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
$$;

-- The primary key's columns of a table, or null when it has none.
create function migration_preview.key_of(tbl text) returns text[]
language sql stable as $$
  select array_agg(a.attname::text order by a.attname)
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = tbl::regclass and i.indisprimary
$$;

create function migration_preview.snapshot() returns void
language plpgsql as $$
declare
  t text;
begin
  insert into migration_preview.columns select * from migration_preview.columns_now();
  for t in select tbl from migration_preview.tables() loop
    insert into migration_preview.keys values (t, migration_preview.key_of(t));
    execute format('insert into migration_preview.rows select %L, to_jsonb(r) from %s r', t, t);
  end loop;
end
$$;

-- The tables and columns added, dropped or altered, and per table the rows added, removed and
-- changed. Rows are compared on the columns the table had before and still has, matched by the
-- primary key it had before; a table without one, or whose key columns are gone, is compared
-- row by row, so a change counts there as a row removed and a row added.
create function migration_preview.report() returns jsonb
language plpgsql as $$
declare
  t text;
  common text[];
  gone text[];
  added_cols text[];
  key text[];
  key_expr text;
  counts jsonb;
  tables jsonb := '[]';
begin
  create temp table after_rows (val jsonb) on commit drop;
  for t in
    select tbl from migration_preview.tables() union select tbl from migration_preview.keys order by 1
  loop
    if not exists (select from migration_preview.keys k where k.tbl = t) then
      execute format('select count(*) from %s', t) into counts;
      tables := tables || jsonb_build_object('table', t, 'status', 'added', 'rows_before', 0,
        'rows_after', counts, 'added', counts, 'removed', 0, 'changed', 0, 'columns', '[]'::jsonb);
      continue;
    end if;
    if not exists (select from migration_preview.tables() n where n.tbl = t) then
      tables := tables || (select jsonb_build_object('table', t, 'status', 'dropped', 'rows_before', count(*),
        'rows_after', 0, 'added', 0, 'removed', count(*), 'changed', 0, 'columns', '[]'::jsonb)
        from migration_preview.rows r where r.tbl = t);
      continue;
    end if;

    select array_agg(b.col) into common
    from migration_preview.columns b join migration_preview.columns_now() a using (tbl, col) where b.tbl = t;
    select coalesce(array_agg(b.col), '{}') into gone from migration_preview.columns b
    where b.tbl = t and b.col <> all (coalesce(common, '{}'));
    select coalesce(array_agg(a.col), '{}') into added_cols from migration_preview.columns_now() a
    where a.tbl = t and a.col <> all (coalesce(common, '{}'));
    select k.cols into key from migration_preview.keys k where k.tbl = t;
    if key is null or not key <@ coalesce(common, '{}') then
      key := common;
    end if;
    key_expr := coalesce((select string_agg(format('val -> %L', c), ', ') from unnest(key) c), 'null');

    truncate after_rows;
    execute format('insert into after_rows select to_jsonb(r) - %L::text[] from %s r', added_cols, t);
    execute format($q$
      with b as (select val - %1$L::text[] as val from migration_preview.rows where tbl = %2$L),
           bk as (select jsonb_build_array(%3$s) as key, val from b),
           ak as (select jsonb_build_array(%3$s) as key, val from after_rows)
      select jsonb_build_object(
        'rows_before', (select count(*) from b),
        'rows_after', (select count(*) from after_rows),
        'added', (select count(*) from (select key from ak except all select key from bk) x),
        'removed', (select count(*) from (select key from bk except all select key from ak) x),
        'changed', (select count(*) from ak join bk using (key) where ak.val <> bk.val))
    $q$, gone, t, key_expr) into counts;

    tables := tables || (counts || jsonb_build_object('table', t, 'status', 'kept', 'columns', coalesce((
      select jsonb_agg(jsonb_build_object('column', coalesce(a.col, b.col),
               'status', case when b.col is null then 'added' when a.col is null then 'dropped' else 'altered' end,
               'before', b.def, 'after', a.def) order by coalesce(a.col, b.col))
      from (select * from migration_preview.columns where tbl = t) b
      full join (select * from migration_preview.columns_now() where tbl = t) a using (tbl, col)
      where a.def is distinct from b.def), '[]'::jsonb)));
  end loop;
  return jsonb_build_object('schemas', jsonb_build_array('public', 'private', 'storage'), 'tables', tables);
end
$$;
