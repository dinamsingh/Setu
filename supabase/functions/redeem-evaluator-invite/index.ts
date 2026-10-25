/**
 * Real SETU 48-hour evaluator invitation redemption.
 * Deploy with verify_jwt=false: invitation token is the bearer authorization.
 * Service-role key stays server-side in the Edge Function environment.
 */
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const prodOrigin = "https://setu-app.pages.dev";
const allowedOrigin = (origin: string): boolean =>
  origin === prodOrigin ||
  /^https:\/\/[a-z0-9-]+\.setu-app\.pages\.dev$/.test(origin) ||
  origin === "http://localhost:5173";
const hex64 = /^[a-f0-9]{64}$/;
const noCache = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function response(body: unknown, status: number, origin?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...noCache,
      ...(origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Vary": "Origin",
      } : {}),
    },
  });
}

function password(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
}
async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (!allowedOrigin(origin)) return response({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      ...noCache,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Vary": "Origin",
    },
  });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !serviceKey) return response({ error: "Evaluator service not configured" }, 503, origin);
  if (Number(request.headers.get("content-length") || "0") > 1024) {
    return response({ error: "Request too large" }, 413, origin);
  }
  const input = await request.json().catch(() => null);
  const token = input && typeof input === "object" && typeof input.token === "string"
    ? input.token.toLowerCase().trim() : "";
  if (!hex64.test(token)) return response({ error: "Invalid or expired invitation" }, 400, origin);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  // Atomically consume the high-entropy, single-use private invitation.
  const { data: redeemed, error: claimError } = await admin.rpc(
    "claim_evaluator_invite", { p_sha256: await sha256(token) },
  );
  if (claimError) return response({ error: "Evaluator access is not configured" }, 503, origin);
  if (!Array.isArray(redeemed) || redeemed.length !== 1) {
    return response({ error: "Invitation has expired or was already used" }, 403, origin);
  }
  const invitation = redeemed[0] as { invite_id: string; expires_at: string };
  if (!invitation?.invite_id || !invitation?.expires_at) {
    return response({ error: "Evaluator invitation invalid" }, 503, origin);
  }

  const generated: { site?: { email: string; password: string }; planner?: { email: string; password: string } } = {};
  const createdIds: string[] = [];
  try {
    for (const role of ["site", "planner"] as const) {
      // Reserved .invalid top-level domain: no real email is sent to anybody.
      const email = "sih-" + role + "-" + invitation.invite_id + "@evaluator.invalid";
      const secret = password();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: secret, email_confirm: true,
        app_metadata: { source: "sih_evaluator", evaluator_role: role },
      });
      if (createError || !created?.user?.id) throw new Error("Could not create a temporary demo user");
      const uid = created.user.id;
      createdIds.push(uid);

      const { error: accessError } = await admin.from("evaluator_accounts").insert({
        user_id: uid, role, invite_id: invitation.invite_id, expires_at: invitation.expires_at,
      });
      if (accessError) throw new Error("Could not secure temporary account expiry");

      const { error: roleError } = await admin.from("user_roles").insert({
        user_id: uid, role,
      });
      if (roleError) throw new Error("Could not assign temporary evaluator role");
      generated[role] = { email, password: secret };
    }
    // Ensure both roles were assigned before giving either credential to browser.
    const { data: assigned, error: verifyError } = await admin
      .from("evaluator_accounts").select("role")
      .eq("invite_id", invitation.invite_id);
    if (verifyError || !assigned ||
      assigned.filter(x => x.role === "site").length !== 1 ||
      assigned.filter(x => x.role === "planner").length !== 1) {
      throw new Error("Evaluator accounts were not fully provisioned");
    }

    return response({
      expiresAt: invitation.expires_at,
      site: generated.site,
      planner: generated.planner,
      mode: "real_authenticated",
    }, 200, origin);
  } catch {
    // Fail closed; the invitation cannot be replayed. Clean up partial accounts.
    for (const uid of createdIds.reverse()) {
      await admin.auth.admin.deleteUser(uid).catch(() => null);
    }
    return response({
      error: "Temporary access could not be created. Ask the SETU team for a new invitation.",
    }, 503, origin);
  }
});
