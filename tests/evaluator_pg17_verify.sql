-- Assertions run ONLY on disposable fixture after applying migration 016.
\set ON_ERROR_STOP on
INSERT INTO public.evaluator_invites(id,token_sha256,valid_until,redeemed_at,access_expires_at)
VALUES('30000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '7 days',now(),now()+interval '48 hours');
INSERT INTO public.evaluator_accounts(user_id,invite_id,role,expires_at)
VALUES
('10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','site',now()+interval '48 hours'),
('10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','planner',now()+interval '48 hours');

-- Emulate a SECURITY DEFINER planner RPC trying to modify a historical report.
CREATE FUNCTION public.test_definer_update_historic()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.field_updates SET status='approved'
  WHERE id='20000000-0000-4000-8000-000000000001'::uuid;
$$;
REVOKE ALL ON FUNCTION public.test_definer_update_historic() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_definer_update_historic() TO authenticated;

SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
DO $$
DECLARE v_count int; v_role text; v_failed boolean := false;
BEGIN
 SELECT public.current_user_role() INTO v_role;
 IF v_role <> 'planner' THEN RAISE EXCEPTION 'Live evaluator planner role not granted'; END IF;
 SELECT count(*) INTO v_count FROM public.field_updates;
 IF v_count <> 1 THEN RAISE EXCEPTION 'Privacy regression: evaluator sees % reports (expected 1)',v_count; END IF;
 BEGIN
   PERFORM public.test_definer_update_historic();
 EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
 END;
 IF NOT v_failed THEN RAISE EXCEPTION 'SECURITY DEFINER bypass changed a historic report'; END IF;
 IF (SELECT count(*) FROM public.schedule_activities) <> 1 THEN
  RAISE EXCEPTION 'Active evaluator cannot see the schedule';
 END IF;
END $$;

-- Project planner unaffected by evaluator scoping.
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
DO $$
BEGIN
 IF public.current_user_role() <> 'planner' OR
   (SELECT count(*) FROM public.field_updates) <> 2 THEN
   RAISE EXCEPTION 'Existing planner regression';
 END IF;
END $$;
RESET ROLE;

-- After expiry, the Supabase JWT alone must NOT authorize reads or decisions.
UPDATE public.evaluator_accounts SET expires_at=now()-interval '1 second'
WHERE invite_id='30000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
DO $$
BEGIN
 IF public.current_user_role() IS NOT NULL THEN RAISE EXCEPTION 'Expired evaluator still has planner role'; END IF;
 IF (SELECT count(*) FROM public.schedule_activities) <> 0 THEN RAISE EXCEPTION 'Expired evaluator can read schedule'; END IF;
 IF (SELECT count(*) FROM public.domain_aliases) <> 0 THEN RAISE EXCEPTION 'Expired evaluator can read aliases'; END IF;
 IF (SELECT count(*) FROM public.field_updates) <> 0 THEN RAISE EXCEPTION 'Expired evaluator can read field reports'; END IF;
 IF (SELECT count(*) FROM public.user_roles) <> 0 THEN RAISE EXCEPTION 'Expired evaluator can read own role'; END IF;
END $$;
RESET ROLE;

-- Single-use token redemption and expiry are server validated (no browser timer authority).
DO $$
DECLARE v_link text; v_token text; v_digest text; v_count int;
BEGIN
 v_link := public.issue_evaluator_invite();
 v_token := substring(v_link from 'invite=(.*)$');
 IF v_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation token is not strong'; END IF;
 v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),'hex');
 SELECT count(*) INTO v_count FROM public.claim_evaluator_invite(v_digest);
 IF v_count <> 1 THEN RAISE EXCEPTION 'First redeem did not succeed'; END IF;
 SELECT count(*) INTO v_count FROM public.claim_evaluator_invite(v_digest);
 IF v_count <> 0 THEN RAISE EXCEPTION 'Invite replay is possible'; END IF;
END $$;
SELECT 'Evaluator PG17 fixture security checks passed' AS result;
