-- ============================================================================
-- discovery-cdt.sql  —  Extração read-only do banco ubwcxktaruxqacxltovq
-- ----------------------------------------------------------------------------
-- REGRA: somente SELECT. Nenhum INSERT/UPDATE/DELETE/DDL.
-- Cada bloco devolve UM blob JSON (json_agg) para gravar verbatim em
--   analise-cdt/raw/bloco-NN.json
-- Queries são baratas: usam catálogo (pg_catalog / information_schema) e views
-- de estatística (pg_stat_*, pg_stat_statements). NUNCA fazem count(*) nem
-- pgstattuple nas tabelas grandes (clientes_cobranca_dashboard ~1.8GB,
-- message_log ~290MB, adimplentes_base ~234MB). Contagens são ESTIMADAS
-- (pg_class.reltuples); reltuples = -1 significa "nunca analisada" → estimativa
-- não confiável, contagem exata fica a cargo do deep-dive da tabela.
-- Snapshot: rodado via MCP execute_sql em 2026-06-02 (America/Sao_Paulo).
-- ============================================================================


-- ── BLOCO 01 — Tabelas (inventário + estatística de uso) ────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    c.relname                                   as tabela,
    c.reltuples::bigint                         as linhas_estimadas,
    pg_total_relation_size(c.oid)               as bytes_total,
    pg_size_pretty(pg_total_relation_size(c.oid)) as tamanho,
    pg_size_pretty(pg_relation_size(c.oid))     as tamanho_heap,
    c.relrowsecurity                            as rls_on,
    c.relforcerowsecurity                       as rls_forced,
    s.seq_scan, s.idx_scan,
    s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
    s.n_live_tup, s.n_dead_tup,
    s.last_analyze, s.last_autoanalyze, s.last_vacuum, s.last_autovacuum,
    (select count(*) from information_schema.columns col
       where col.table_schema='public' and col.table_name=c.relname) as n_cols,
    (select count(*) from pg_policies p
       where p.schemaname='public' and p.tablename=c.relname)        as n_policies,
    obj_description(c.oid)                       as comentario
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
  left join pg_stat_user_tables s on s.relid = c.oid
  where c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc
) t;


-- ── BLOCO 02 — Colunas (backbone da análise coluna a coluna) ────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    col.table_name                     as tabela,
    col.ordinal_position               as pos,
    col.column_name                    as coluna,
    col.data_type,
    col.udt_name,
    col.is_nullable,
    col.column_default,
    col.character_maximum_length       as max_len,
    col.numeric_precision,
    col_description(pgc.oid, col.ordinal_position) as comentario
  from information_schema.columns col
  join pg_class pgc      on pgc.relname = col.table_name
  join pg_namespace n    on n.oid = pgc.relnamespace
                        and n.nspname = col.table_schema
  where col.table_schema = 'public' and pgc.relkind in ('r','v','m','p')
  order by col.table_name, col.ordinal_position
) t;


-- ── BLOCO 03 — Foreign keys (arestas do grafo de dependência) ───────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    con.conname as constraint_name,
    src.relname as tabela,
    (select array_agg(a.attname order by k.ord)
       from unnest(con.conkey) with ordinality k(attnum,ord)
       join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum) as colunas,
    tgt.relname as ref_tabela,
    (select array_agg(a.attname order by k.ord)
       from unnest(con.confkey) with ordinality k(attnum,ord)
       join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum) as ref_colunas,
    con.confdeltype as on_delete,
    con.confupdtype as on_update
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_namespace n on n.oid = src.relnamespace and n.nspname='public'
  join pg_class tgt on tgt.oid = con.confrelid
  where con.contype = 'f'
  order by src.relname, con.conname
) t;


-- ── BLOCO 04 — Índices (+ uso; idx_scan=0 = nunca usado) ────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    tb.relname             as tabela,
    i.relname              as index_name,
    ix.indisunique         as is_unique,
    ix.indisprimary        as is_primary,
    s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
    pg_relation_size(i.oid) as bytes,
    pg_get_indexdef(i.oid) as definicao
  from pg_index ix
  join pg_class i  on i.oid  = ix.indexrelid
  join pg_class tb on tb.oid = ix.indrelid
  join pg_namespace n on n.oid = tb.relnamespace and n.nspname='public'
  left join pg_stat_user_indexes s on s.indexrelid = i.oid
  order by tb.relname, i.relname
) t;


-- ── BLOCO 05a — Funções: metadados (sem corpo) ──────────────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    p.proname                                   as funcao,
    pg_get_function_identity_arguments(p.oid)   as args,
    pg_get_function_result(p.oid)               as retorno,
    l.lanname                                   as linguagem,
    p.prosecdef                                 as security_definer,
    case p.provolatile when 'i' then 'immutable'
                       when 's' then 'stable'
                       else 'volatile' end       as volatilidade,
    p.proconfig                                 as config,
    obj_description(p.oid)                       as comentario
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
  join pg_language  l on l.oid = p.prolang
  order by p.proname
) t;


-- ── BLOCO 05b — Funções: definição completa (corpo) — ARQUIVO GRANDE ────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    p.proname                                 as funcao,
    pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid)                 as definicao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
  order by p.proname
) t;


-- ── BLOCO 06 — Triggers (inclui database webhooks via net.http_post) ────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    tb.relname as tabela,
    tg.tgname  as trigger_name,
    case when (tg.tgtype::int & 1)  > 0 then 'ROW' else 'STATEMENT' end as nivel,
    case when (tg.tgtype::int & 2)  > 0 then 'BEFORE'
         when (tg.tgtype::int & 64) > 0 then 'INSTEAD OF'
         else 'AFTER' end as timing,
    array_remove(array[
      case when (tg.tgtype::int & 4)  > 0 then 'INSERT'   end,
      case when (tg.tgtype::int & 8)  > 0 then 'DELETE'   end,
      case when (tg.tgtype::int & 16) > 0 then 'UPDATE'   end,
      case when (tg.tgtype::int & 32) > 0 then 'TRUNCATE' end
    ], null) as eventos,
    p.proname  as funcao,
    case tg.tgenabled when 'O' then 'enabled' when 'D' then 'disabled'
                      when 'R' then 'replica' else 'always' end as estado,
    pg_get_triggerdef(tg.oid) as definicao
  from pg_trigger tg
  join pg_class tb on tb.oid = tg.tgrelid
  join pg_namespace n on n.oid = tb.relnamespace and n.nspname='public'
  join pg_proc p on p.oid = tg.tgfoid
  where not tg.tgisinternal
  order by tb.relname, tg.tgname
) t;


-- ── BLOCO 07 — Views e materialized views (definição completa) ──────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select
    c.relname as view_name,
    case c.relkind when 'm' then 'materialized' else 'view' end as tipo,
    pg_get_viewdef(c.oid, true) as definicao,
    obj_description(c.oid) as comentario
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
  where c.relkind in ('v','m')
  order by c.relname
) t;


-- ── BLOCO 08 — Enums ────────────────────────────────────────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select tp.typname as enum_name,
         array_agg(e.enumlabel order by e.enumsortorder) as valores
  from pg_type tp
  join pg_enum e      on e.enumtypid = tp.oid
  join pg_namespace n on n.oid = tp.typnamespace and n.nspname='public'
  group by tp.typname
  order by tp.typname
) t;


-- ── BLOCO 09 — RLS policies ─────────────────────────────────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname='public'
  order by tablename, policyname
) t;


-- ── BLOCO 10a — pg_stat_statements: TOP 200 por tempo total ─────────────────
-- ATENÇÃO: query text é normalizado ($1) e pode estar truncado → atribuição
-- é statement-level (não coluna a coluna). stats_reset no bloco 10c.
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select queryid, calls, rows,
         round(total_exec_time::numeric, 1) as total_ms,
         round(mean_exec_time::numeric, 2)  as mean_ms,
         query
  from extensions.pg_stat_statements
  where query !~* 'pg_stat_statements'
  order by total_exec_time desc
  limit 200
) t;


-- ── BLOCO 10b — pg_stat_statements: TOP 200 por nº de chamadas ──────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select queryid, calls, rows,
         round(total_exec_time::numeric, 1) as total_ms,
         round(mean_exec_time::numeric, 2)  as mean_ms,
         query
  from extensions.pg_stat_statements
  where query !~* 'pg_stat_statements'
  order by calls desc
  limit 200
) t;


-- ── BLOCO 10c — pg_stat_statements: janela do snapshot ──────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select stats_reset, now() as snapshot_at, now()-stats_reset as janela
  from extensions.pg_stat_statements_info
) t;


-- ── BLOCO 11 — pg_cron: jobs + resumo de execuções ──────────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select j.jobid, j.jobname, j.schedule, j.active, j.nodename, j.command,
         r.runs, r.last_run, r.last_status, r.failed
  from cron.job j
  left join lateral (
    select count(*) as runs, max(end_time) as last_run,
           count(*) filter (where status='failed') as failed,
           (array_agg(status order by end_time desc))[1] as last_status
    from cron.job_run_details d where d.jobid = j.jobid
  ) r on true
  order by j.jobid
) t;


-- ── BLOCO 12 — Realtime publication membership ──────────────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select pubname, schemaname, tablename
  from pg_publication_tables
  order by pubname, schemaname, tablename
) t;


-- ── BLOCO 13 — Storage: buckets + estatística de objetos ────────────────────
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select b.id as bucket, b.public, b.file_size_limit, b.allowed_mime_types,
         count(o.id) as objetos,
         pg_size_pretty(coalesce(sum((o.metadata->>'size')::bigint),0)) as tamanho_total,
         min(o.created_at) as primeiro, max(o.created_at) as ultimo
  from storage.buckets b
  left join storage.objects o on o.bucket_id = b.id
  group by b.id, b.public, b.file_size_limit, b.allowed_mime_types
  order by b.id
) t;


-- ── BLOCO 14 — Database webhooks (supabase_functions.hooks) — pode não existir
-- Se o schema/relação não existir, registrar a falha no 00-resumo.md.
select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (
  select hook_table_id, hook_name, type, request_id, created_at
  from supabase_functions.hooks
  order by created_at desc
  limit 200
) t;
