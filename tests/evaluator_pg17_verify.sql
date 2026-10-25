-- Native PostgreSQL fixture only. NEVER run against production.
\set ON_ERROR_STOP on
INSERT INTO public.evaluator_workspaces(id,ip_hash,expires_at)
VALUES
('30000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '48 hours'),
('30000000-0000-4000-8000-000000000002',repeat('b',64),now()+interval '48 hours');
INSERT INTO public.evaluator_accounts(user_id,workspace_id,role,expires_at)
VALUES
('10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','site',now()+interval '48 hours'),
('10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','planner',now()+interval '48 hours'),
('10000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000002','site',now()+interval '48 hours'),
('10000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000002','planner',now()+interval '48 hours');
INSERT INTO public.planner_audit_logs(field_update_id) VALUES
('20000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002'),
('20000000-0000-4000-8000-000000000003');
CREATE FUNCTION public.test_definer_update(p_report uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.field_updates SET status='approved' WHERE id=p_report;
$$;
REVOKE ALL ON FUNCTION public.test_definer_update(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_definer_update(uuid) TO authenticated;

-- Workspace A planner may see only Supervisor A report/audit, not B or main.
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
DO $$
DECLARE v_count int; blocked boolean:=false;
BEGIN
 IF public.current_user_role() <> 'planner' THEN RAISE EXCEPTION 'Workspace A has no planner role'; END IF;
 SELECT count(*) INTO v_count FROM public.field_updates;
 IF v_count<>1 THEN RAISE EXCEPTION 'Workspace A can see % reports; expected 1',v_count; END IF;
 SELECT count(*) INTO v_count FROM public.planner_audit_logs;
 IF v_count<>1 THEN RAISE EXCEPTION 'Workspace A can see % audit rows; expected 1',v_count; END IF;
 BEGIN
  PERFORM public.test_definer_update('20000000-0000-4000-8000-000000000003');
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Workspace A mutated B report through definer'; END IF;
 blocked:=false;
 BEGIN
  PERFORM public.test_definer_update('20000000-0000-4000-8000-000000000001');
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Workspace A mutated original production report'; END IF;
END $$;

-- Workspace B is independent.
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',false);
DO $$
DECLARE v_text text; blocked boolean:=false;
BEGIN
 SELECT field_text INTO v_text FROM public.field_updates LIMIT 1;
 IF v_text<>'demo report B' THEN RAISE EXCEPTION 'Workspace B sees A or production'; END IF;
 BEGIN PERFORM public.test_definer_update('20000000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Workspace B mutated A report'; END IF;
END $$;

-- Normal original planner cannot see or mutate either public demo workspace.
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
DO $$
DECLARE v_text text; blocked boolean:=false;
BEGIN
 IF public.current_user_role()<>'planner' THEN RAISE EXCEPTION 'Original planner role regressed'; END IF;
 SELECT field_text INTO v_text FROM public.field_updates LIMIT 1;
 IF v_text<>'historic project' THEN RAISE EXCEPTION 'Normal planner leaked demo data'; END IF;
 BEGIN PERFORM public.test_definer_update('20000000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Normal planner mutated evaluator data'; END IF;
END $$;
RESET ROLE;

-- Workspace A expires, while workspace B still works.
UPDATE public.evaluator_workspaces SET expires_at=now()-interval '1 second'
WHERE id='30000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
DO $$
BEGIN
 IF public.current_user_role() IS NOT NULL THEN RAISE EXCEPTION 'Expired planner still has a role'; END IF;
 IF (SELECT count(*) FROM public.field_updates)<>0 THEN RAISE EXCEPTION 'Expired planner can read reports'; END IF;
 IF (SELECT count(*) FROM public.planner_audit_logs)<>0 THEN RAISE EXCEPTION 'Expired planner can read audit'; END IF;
 IF (SELECT count(*) FROM public.schedule_activities)<>0 THEN RAISE EXCEPTION 'Expired planner sees schedule'; END IF;
 IF (SELECT count(*) FROM public.domain_aliases)<>0 THEN RAISE EXCEPTION 'Expired planner sees alias table'; END IF;
 IF (SELECT count(*) FROM public.user_roles)<>0 THEN RAISE EXCEPTION 'Expired planner sees its role'; END IF;
END $$;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',false);
DO $$ BEGIN
 IF public.current_user_role()<>'planner' OR (SELECT count(*) FROM public.field_updates)<>1 THEN
  RAISE EXCEPTION 'Expiring A unexpectedly disabled B';
 END IF;
END $$;
RESET ROLE;

-- Each account-generation reservation is exactly 48h and rate limited per IP.
DO $$
DECLARE v_id uuid; v_expiry timestamptz; blocked boolean:=false;
BEGIN
 SELECT workspace_id,expires_at INTO v_id,v_expiry FROM public.reserve_evaluator_workspace(repeat('f',64));
 IF v_id IS NULL OR v_expiry<now()+interval '47 hours 59 minutes'
    OR v_expiry>now()+interval '48 hours 1 minute' THEN
  RAISE EXCEPTION 'Reserved workspace did not receive 48h expiry';
 END IF;
 SELECT workspace_id INTO v_id FROM public.reserve_evaluator_workspace(repeat('f',64));
 IF v_id IS NULL THEN RAISE EXCEPTION 'Second workspace should be permitted'; END IF;
 BEGIN PERFORM * FROM public.reserve_evaluator_workspace(repeat('f',64));
 EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Per-IP issuance quota was bypassed'; END IF;
END $$;
SELECT 'Public evaluator group isolation + expiration + quotas: PASS' AS result;
