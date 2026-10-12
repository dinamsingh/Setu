-- Phase 3 Part 3A. Apply only after 012, in a separately authorized deployment.
-- Browser confirmation stays disabled. No changes to existing RLS or RPCs.
begin;

-- Owner-only receipts. Actor UUIDs are historical snapshots, as in workflow 008.
create table public.field_report_import_batches (
    actor_user_id uuid not null,
    request_id uuid not null,
    source_format text not null check (source_format in ('csv', 'xlsx')),
    payload jsonb not null check (jsonb_typeof(payload) = 'array'),
    summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
    created_at timestamptz not null default now(),
    primary key (actor_user_id, request_id)
);

create table public.field_report_import_rows (
    actor_user_id uuid not null,
    fingerprint bytea not null check (octet_length(fingerprint) = 32),
    canonical_row jsonb not null check (jsonb_typeof(canonical_row) = 'array'),
    -- Reserve identity before insertion. FK is checked at transaction commit.
    field_update_id uuid not null unique references public.field_updates(id)
        on delete restrict deferrable initially deferred,
    update_id text not null unique,
    created_at timestamptz not null default now(),
    primary key (actor_user_id, fingerprint)
);

alter table public.field_report_import_batches enable row level security;
alter table public.field_report_import_rows enable row level security;
-- No browser policies or direct ledger privileges, including service-role clients.
revoke all on public.field_report_import_batches, public.field_report_import_rows
    from public, anon, authenticated, service_role;

-- Existing browser INSERT rights remain for manual reports. Spreadsheet tags
-- require a protected reservation; imported reporter text is also immutable.
create function public.protect_spreadsheet_field_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if auth.role() = 'service_role' then return new; end if;
    if tg_op = 'INSERT' and new.source_type in ('spreadsheet_csv', 'spreadsheet_xlsx') then
        if not exists (
            select 1 from public.field_report_import_rows as r
            where r.field_update_id = new.id and r.actor_user_id = auth.uid()
                and new.submitted_by_user_id = r.actor_user_id and r.update_id = new.update_id
                and r.canonical_row = pg_catalog.jsonb_build_array(
                    new.field_text, new.site_location, pg_catalog.to_char(new.reported_date, 'YYYY-MM-DD'),
                    new.reported_by, new.discipline)
        ) then
            raise exception 'Spreadsheet reports must use the secure import RPC' using errcode = '42501';
        end if;
    elsif tg_op = 'UPDATE' and old.source_type in ('spreadsheet_csv', 'spreadsheet_xlsx')
        and old.reported_by is distinct from new.reported_by then
        raise exception 'Immutable field: imported reported_by cannot be modified';
    end if;
    return new;
end;
$$;
revoke execute on function public.protect_spreadsheet_field_update()
    from public, anon, authenticated, service_role;
create trigger trg_protect_spreadsheet_field_update
before insert or update on public.field_updates
for each row execute function public.protect_spreadsheet_field_update();

create function public.import_field_reports(p_request_id uuid, p_source_format text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_row jsonb; v_clean jsonb; v_value text; v_key text; v_date date;
    v_position integer := 0; v_number integer; v_numbers integer[] := '{}';
    v_errors jsonb := '[]'; v_row_errors jsonb; v_normalized jsonb := '[]';
    v_error_count integer := 0; v_imported integer := 0; v_duplicates integer := 0;
    v_total integer; v_canonical jsonb; v_hash bytea; v_id uuid; v_update_id text; v_outcome text;
    v_outcomes jsonb := '[]'; v_summary jsonb;
    v_batch public.field_report_import_batches%rowtype;
    v_existing public.field_report_import_rows%rowtype;
    -- JavaScript trim whitespace; normalization never changes narrative case.
    v_trim text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
    if v_actor is null or auth.role() is distinct from 'authenticated'
        or coalesce(public.current_user_role(), '') not in ('site', 'engineer') then
        raise exception 'Only authenticated site or engineer users may import reports' using errcode = '42501';
    end if;
    if p_request_id is null or p_source_format is null or p_source_format not in ('csv', 'xlsx')
        or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'A request UUID, csv/xlsx source format and row array are required' using errcode = '22023';
    end if;
    v_total := pg_catalog.jsonb_array_length(p_rows);
    if v_total < 1 or v_total > 1000
        or pg_catalog.octet_length(p_rows::text) > 16777216 then
        raise exception 'Import limit: 1 to 1000 rows and at most 16 MiB JSON payload' using errcode = '22023';
    end if;

    -- Full validation precedes every persistent write. Do not use typed-record
    -- coercion: JSON numbers/booleans must not silently become narrative strings.
    for v_row in select value from pg_catalog.jsonb_array_elements(p_rows) loop
        v_position := v_position + 1; v_number := v_position + 1;
        v_clean := '{}'; v_row_errors := '[]';
        if pg_catalog.jsonb_typeof(v_row) is distinct from 'object' then
            v_row_errors := '[{"field":null,"code":"invalid_row","message":"Each row must be an object."}]';
        else
            if pg_catalog.jsonb_typeof(v_row->'row_number') is distinct from 'number'
                or coalesce(v_row->>'row_number', '') !~ '^[0-9]{1,4}$' then
                v_row_errors := v_row_errors || '[{"field":"row_number","code":"invalid_row_number","message":"An integer source row number is required."}]';
            else
                v_number := (v_row->>'row_number')::integer;
                if v_number < 2 or v_number > 1001 or v_number = any(v_numbers) then
                    v_row_errors := v_row_errors || '[{"field":"row_number","code":"invalid_row_number","message":"Source row numbers must be unique, between 2 and 1001."}]';
                end if;
                v_numbers := pg_catalog.array_append(v_numbers, v_number);
            end if;
            if exists (select 1 from pg_catalog.jsonb_object_keys(v_row) as k(key)
                where key not in ('row_number', 'field_text', 'site_location', 'reported_date', 'reported_by', 'discipline')) then
                v_row_errors := v_row_errors || '[{"field":null,"code":"unexpected_field","message":"Only original report fields and row_number are accepted."}]';
            end if;
            foreach v_key in array array['field_text', 'site_location', 'reported_date', 'reported_by', 'discipline'] loop
                v_value := null;
                if v_row ? v_key and v_row->v_key <> 'null'::jsonb then
                    if pg_catalog.jsonb_typeof(v_row->v_key) <> 'string' then
                        v_row_errors := v_row_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                            'field', v_key, 'code', 'invalid_type', 'message', 'Use text or null, not numbers, lists or objects.'));
                    else
                        v_value := v_row->>v_key;
                        if pg_catalog.char_length(v_value) > 10000 or v_value ~ (
                            '[' || pg_catalog.chr(1) || '-' || pg_catalog.chr(8) || pg_catalog.chr(11)
                            || pg_catalog.chr(12) || pg_catalog.chr(14) || '-' || pg_catalog.chr(31) || ']') then
                            v_row_errors := v_row_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                                'field', v_key, 'code', 'invalid_text', 'message', 'Text must be at most 10000 characters without unsafe control characters.'));
                        end if;
                        v_value := nullif(pg_catalog.btrim(v_value, v_trim), '');
                    end if;
                end if;
                v_clean := v_clean || pg_catalog.jsonb_build_object(v_key, v_value);
            end loop;
            if v_clean->>'field_text' is null then
                v_row_errors := v_row_errors || '[{"field":"field_text","code":"required_value","message":"A written field update is required."}]';
            end if;
            v_value := v_clean->>'reported_date'; v_date := null;
            if coalesce(v_value, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                begin
                    v_date := v_value::date;
                exception when invalid_datetime_format or datetime_field_overflow then
                    v_date := null;
                end;
            end if;
            if v_date is null then
                v_row_errors := v_row_errors || '[{"field":"reported_date","code":"invalid_date","message":"A valid YYYY-MM-DD report date is required."}]';
            end if;
            v_value := v_clean->>'discipline';
            if v_value is not null then
                select d into v_value from pg_catalog.unnest(array['Piping','Pipeline','Civil','Electrical','Mechanical','Instrumentation']) as d
                    where pg_catalog.lower(d) = pg_catalog.lower(v_value);
                if v_value is null then
                    v_row_errors := v_row_errors || '[{"field":"discipline","code":"unsupported_discipline","message":"Choose Piping, Pipeline, Civil, Electrical, Mechanical or Instrumentation."}]';
                else v_clean := v_clean || pg_catalog.jsonb_build_object('discipline', v_value);
                end if;
            end if;
        end if;
        if pg_catalog.jsonb_array_length(v_row_errors) > 0 then
            v_error_count := v_error_count + 1;
            select v_errors || pg_catalog.jsonb_agg(e || pg_catalog.jsonb_build_object('row_number', v_number, 'input_index', v_position))
                into v_errors from pg_catalog.jsonb_array_elements(v_row_errors) as e;
        end if;
        v_normalized := v_normalized || pg_catalog.jsonb_build_array(v_clean || pg_catalog.jsonb_build_object('row_number', v_number));
    end loop;
    if v_error_count > 0 then
        return pg_catalog.jsonb_build_object('status','rejected','request_id',p_request_id,
            'total_rows',v_total,'imported_count',0,'duplicate_count',0,'error_count',v_error_count,
            'replayed',false,'rows','[]'::jsonb,'errors',v_errors);
    end if;

    insert into public.field_report_import_batches(actor_user_id, request_id, source_format, payload)
        values (v_actor, p_request_id, p_source_format, p_rows)
        on conflict (actor_user_id, request_id) do nothing;
    if not found then
        -- Separate statement sees the conflicting commit at READ COMMITTED.
        select * into v_batch from public.field_report_import_batches
            where actor_user_id = v_actor and request_id = p_request_id;
        if not found or v_batch.summary is null then
            raise exception 'Import receipt not available; retry the same request' using errcode = '40001';
        end if;
        if v_batch.payload is distinct from p_rows or v_batch.source_format is distinct from p_source_format then
            raise exception 'Request UUID already used for different import content' using errcode = '22023';
        end if;
        select pg_catalog.jsonb_agg(value || '{"outcome":"duplicate"}'::jsonb order by ordinality)
            into v_outcomes from pg_catalog.jsonb_array_elements(v_batch.summary->'rows') with ordinality;
        return v_batch.summary || pg_catalog.jsonb_build_object('imported_count',0,'duplicate_count',v_total,
            'replayed',true,'rows',v_outcomes);
    end if;

    -- Same canonical content is deduped across source formats/uploads for this
    -- actor. Stable fingerprint order prevents opposite-order batch deadlocks.
    for v_row in
        select r || pg_catalog.jsonb_build_object('canonical', c, 'fingerprint',
            pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c::text, 'UTF8')), 'hex'))
        from (select value as r, pg_catalog.jsonb_build_array(value->>'field_text', value->>'site_location',
            value->>'reported_date', value->>'reported_by', value->>'discipline') as c
            from pg_catalog.jsonb_array_elements(v_normalized)) as canonical
        order by pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c::text, 'UTF8')), 'hex'), (r->>'row_number')::integer
    loop
        v_canonical := v_row->'canonical'; v_hash := pg_catalog.decode(v_row->>'fingerprint', 'hex');
        v_id := pg_catalog.gen_random_uuid(); v_update_id := 'UPD-IMP-' || v_id::text;
        insert into public.field_report_import_rows(actor_user_id, fingerprint, canonical_row, field_update_id, update_id)
            values (v_actor, v_hash, v_canonical, v_id, v_update_id)
            on conflict (actor_user_id, fingerprint) do nothing;
        if found then
            v_outcome := 'imported';
            insert into public.field_updates(id, update_id, source_type, field_text, site_location,
                reported_date, reported_by, discipline, submitted_by_user_id, status, confidence_level,
                confidence_score, matched_activity_id, expanded_text, matched_layer, candidate_matches,
                validation_status, validation_results, validation_overridden)
            values (v_id, v_update_id, 'spreadsheet_' || p_source_format, v_row->>'field_text', v_row->>'site_location',
                (v_row->>'reported_date')::date, v_row->>'reported_by', v_row->>'discipline', v_actor,
                'pending', 'Pending', 0, null, null, null, '[]', null, '[]', false);
            v_imported := v_imported + 1;
        else
            v_outcome := 'duplicate';
            select * into v_existing from public.field_report_import_rows
                where actor_user_id = v_actor and fingerprint = v_hash;
            if not found then raise exception 'Duplicate receipt not available; retry' using errcode = '40001'; end if;
            if v_existing.canonical_row is distinct from v_canonical then
                raise exception 'Report fingerprint collision; nothing imported' using errcode = '23505';
            end if;
            v_id := v_existing.field_update_id; v_update_id := v_existing.update_id;
            v_duplicates := v_duplicates + 1;
        end if;
        v_outcomes := v_outcomes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'row_number',(v_row->>'row_number')::integer,'outcome',v_outcome,
            'field_update_id',v_id,'update_id',v_update_id));
    end loop;
    select pg_catalog.jsonb_agg(value order by (value->>'row_number')::integer)
        into v_outcomes from pg_catalog.jsonb_array_elements(v_outcomes);
    v_summary := pg_catalog.jsonb_build_object('status','completed','request_id',p_request_id,
        'total_rows',v_total,'imported_count',v_imported,'duplicate_count',v_duplicates,'error_count',0,
        'replayed',false,'rows',v_outcomes,'errors','[]'::jsonb);
    update public.field_report_import_batches set summary = v_summary
        where actor_user_id = v_actor and request_id = p_request_id;
    return v_summary;
    -- No per-row exception swallowing. Any storage failure rolls back the
    -- reports, fingerprint reservations and batch receipt together.
end;
$$;
revoke execute on function public.import_field_reports(uuid, text, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.import_field_reports(uuid, text, jsonb) to authenticated;

commit;
