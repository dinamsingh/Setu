/**
 * PLANNER-CREATED SUPERVISORS, scoped to one schedule baseline.
 *
 * A planner (or admin) with a valid JWT creates a supervisor account for
 * one baseline they own, or for the labelled Sample Baseline (demo only).
 * The service_role key lives ONLY in this function's environment — it is
 * never sent to the browser, never stored in git, and never logged.
 * The generated password is returned ONCE and is never stored in the DB.
 */
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  isValidUuid,
  isValidWorkEmail,
  makePlannerSupervisorPassword,
} from "./credentials.ts";

const allowedOrigin = (origin: string): boolean =>
  origin === "https://setu-app.pages.dev" ||
  /^https:\/\/[a-z0-9-]+\.setu-app\.pages\.dev$/.test(origin) ||
  origin === "http://localhost:5173";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function reply(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

Deno.serve(async (request) => {
  // Read-only diagnostics: never expose secret values or create an account.
  if (request.method === "GET" && new URL(request.url).searchParams.get("health") === "1") {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ status: "not_configured" }),
        { status: 503, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.from("schedule_baselines").select("id", { head: true }).limit(1);
    return new Response(JSON.stringify({ status: error ? "database_unavailable" : "ready" }),
      { status: error ? 503 : 200, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const origin = request.headers.get("origin") || "";
  if (!allowedOrigin(origin)) return new Response("Forbidden", { status: 403, headers });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204, headers: {
        ...headers, "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Vary": "Origin",
      },
    });
  }
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) return reply({ error: "Planner supervisor setup is not configured" }, 503, origin);

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return reply({ error: "Sign in as a planner to add a supervisor." }, 401, origin);

  const length = Number(request.headers.get("content-length") || "0");
  if (length > 4096) return reply({ error: "Request too large" }, 413, origin);
  const input: unknown = await request.json().catch(() => null);
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const supervisorName = typeof value?.supervisorName === "string" ? value.supervisorName.trim() : "";
  const workEmail = typeof value?.workEmail === "string" ? value.workEmail.trim().toLowerCase() : "";
  const baselineId = typeof value?.baselineId === "string" ? value.baselineId.trim() : "";
  if (!supervisorName || supervisorName.length < 2 || supervisorName.length > 100) {
    return reply({ error: "Supervisor name is required (2–100 characters)." }, 400, origin);
  }
  if (!isValidWorkEmail(workEmail)) return reply({ error: "Enter a valid work email." }, 400, origin);
  if (!isValidUuid(baselineId)) return reply({ error: "Choose a valid schedule baseline." }, 400, origin);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // Verify the caller's JWT and role. The role comes from user_roles, never
  // from a client-supplied string.
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user?.id) return reply({ error: "Sign in as a planner to add a supervisor." }, 401, origin);
  const callerId = caller.user.id;
  const { data: callerRole, error: roleError } = await admin.from("user_roles")
    .select("role").eq("user_id", callerId).maybeSingle();
  if (roleError || !callerRole || (callerRole.role !== "planner" && callerRole.role !== "admin")) {
    return reply({ error: "Only a planner or admin can add a supervisor." }, 403, origin);
  }

  // Baseline ownership: own baseline, or the labelled Sample Baseline (demo).
  const { data: baseline, error: baselineError } = await admin.from("schedule_baselines")
    .select("id, name, owner_planner_id, is_sample").eq("id", baselineId).maybeSingle();
  if (baselineError || !baseline) return reply({ error: "Schedule baseline not found." }, 404, origin);
  const isSample = baseline.is_sample === true;
  if (!isSample && baseline.owner_planner_id !== callerId && callerRole.role !== "admin") {
    return reply({ error: "You can only add supervisors to your own schedule baselines." }, 403, origin);
  }

  const password = makePlannerSupervisorPassword();
  let supervisorId: string | null = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: workEmail,
      password,
      email_confirm: true,
      app_metadata: { source: "planner_supervisor", baseline_id: baselineId },
      user_metadata: { supervisor_name: supervisorName },
    });
    if (createError || !created?.user?.id) {
      const msg = String(createError?.message || "");
      if (/already|registered|exists/i.test(msg)) {
        return reply({ error: "This work email is already registered. Use a different email or sign in with the existing account." }, 409, origin);
      }
      throw new Error("Auth provisioning failed");
    }
    supervisorId = created.user.id;
    const { error: roleInsertError } = await admin.from("user_roles")
      .insert({ user_id: supervisorId, role: "site" });
    if (roleInsertError) throw new Error("Role assignment failed");
    const { error: assignmentError } = await admin.from("planner_supervisor_assignments")
      .insert({ baseline_id: baselineId, supervisor_id: supervisorId, planner_id: callerId });
    if (assignmentError) throw new Error("Assignment failed");
    // Returned ONCE. Never stored in the database and never logged.
    return reply({
      email: workEmail,
      password,
      supervisor_id: supervisorId,
      baseline_id: baselineId,
      baseline_name: baseline.name,
      is_sample: isSample,
    }, 200, origin);
  } catch {
    // Fail closed: remove a partially created account so no orphan login
    // exists without a role and an assignment.
    if (supervisorId) {
      try { await admin.auth.admin.deleteUser(supervisorId); } catch { /* no secret in logs */ }
    }
    return reply({ error: "Could not create this supervisor. Please try again." }, 503, origin);
  }
});
