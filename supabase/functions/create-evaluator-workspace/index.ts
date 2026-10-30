/**
 * PUBLIC, TURNSTILE-VERIFIED, RATE-LIMITED disposable workspace provisioning.
 * Produces TWO REAL Supabase Auth accounts (Supervisor and Planner), linked by
 * workspace_id. Never copy the service_role key into a browser build.
 */
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { makeEvaluatorCredentials } from "./credentials.ts";

const allowedOrigin = (origin: string): boolean =>
  origin === "https://setu-app.pages.dev" ||
  /^https:\/\/[a-z0-9-]+\.setu-app\.pages\.dev$/.test(origin) ||
  origin === "http://localhost:5173";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function reply(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status, headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
async function sha256(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,"0")).join("");
}
async function verifyChallenge(token: string, secret: string, ip: string): Promise<boolean> {
  const body = new FormData();
  body.set("secret",secret);
  body.set("response",token);
  if(ip)body.set("remoteip",ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {method:"POST",body,signal:AbortSignal.timeout(6000)});
  if(!res.ok)return false;
  const output: unknown = await res.json();
  if(!output || typeof output !== "object")return false;
  const data = output as {success?: boolean; hostname?: string; action?: string};
  // Reject challenges solved on a different origin/app.
  return data.success === true && data.action === "setu_evaluator" &&
    typeof data.hostname === "string" &&
    (data.hostname === "setu-app.pages.dev" ||
     /^[a-z0-9-]+\.setu-app\.pages\.dev$/.test(data.hostname) ||
     data.hostname === "localhost");
}
Deno.serve(async (request)=>{
  // Read-only diagnostics: never expose the secret values or create an account.
  // This lets release verification distinguish deployed code from usable setup.
  if(request.method==="GET" && new URL(request.url).searchParams.get("health")==="1"){
    const url=Deno.env.get("SUPABASE_URL");
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const turnstile=Deno.env.get("EVALUATOR_TURNSTILE_SECRET");
    const pepper=Deno.env.get("EVALUATOR_RATE_LIMIT_PEPPER");
    const configured=Boolean(url&&key&&turnstile&&pepper&&pepper.length>=32);
    if(!configured) return new Response(JSON.stringify({status:"not_configured"}),
      {status:503,headers:{...headers,"Content-Type":"application/json"}});
    const admin=createClient(url!,key!,{auth:{autoRefreshToken:false,persistSession:false}});
    const {error}=await admin.from("evaluator_workspaces").select("id",{head:true}).limit(1);
    return new Response(JSON.stringify({status:error?"database_unavailable":"ready"}),
      {status:error?503:200,headers:{...headers,"Content-Type":"application/json"}});
  }
  const origin = request.headers.get("origin") || "";
  if(!allowedOrigin(origin))return new Response("Forbidden",{status:403,headers});
  if(request.method==="OPTIONS"){
    return new Response(null,{status:204,headers:{
      ...headers,"Access-Control-Allow-Origin":origin,
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
      "Vary":"Origin",
    }});
  }
  if(request.method!=="POST")return reply({error:"Method not allowed"},405,origin);
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url=Deno.env.get("SUPABASE_URL");
  const challengeSecret=Deno.env.get("EVALUATOR_TURNSTILE_SECRET");
  const ratePepper=Deno.env.get("EVALUATOR_RATE_LIMIT_PEPPER");
  if(!serviceKey || !url || !challengeSecret || !ratePepper || ratePepper.length<32)
    return reply({error:"Public evaluator signup is not configured"},503,origin);

  const length=Number(request.headers.get("content-length") || "0");
  if(length>2048)return reply({error:"Request too large"},413,origin);
  const input: unknown=await request.json().catch(()=>null);
  const value=input && typeof input==="object" ? input as Record<string,unknown> : null;
  const challenge=typeof value?.turnstileToken==="string" ? value.turnstileToken : "";
  if(!challenge || challenge.length>2048) return reply({error:"Complete the security check to get demo access"},400,origin);

  // Header supplied by the trusted hosting proxy; global limits are also
  // enforced in SQL so a forged/missing IP cannot mint unbounded accounts.
  const ip=(request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] || "").trim().slice(0,100);
  try{
    if(!(await verifyChallenge(challenge,challengeSecret,ip)))
      return reply({error:"Security verification failed. Please try again."},403,origin);
  }catch{
    return reply({error:"Security check unavailable. Please retry."},503,origin);
  }

  const admin=createClient(url,serviceKey,{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
  });
  const hash=await sha256(ratePepper+"|"+ip);
  const {data:reserved,error:reserveError}=await admin.rpc(
    "reserve_evaluator_workspace",{p_ip_hash:hash});
  if(reserveError){
    const limit=String(reserveError.message||"").includes("quota");
    return reply({error:limit?"Too many demo accounts have been created. Try again later.":
      "Evaluator service is temporarily unavailable."},limit?429:503,origin);
  }
  if(!Array.isArray(reserved) || reserved.length!==1)
    return reply({error:"Evaluator account reservation failed"},503,origin);
  const workspace=reserved[0] as {workspace_id:string;expires_at:string};
  if(!workspace?.workspace_id || !workspace?.expires_at)
    return reply({error:"Evaluator workspace was not reserved"},503,origin);

  const accounts: {
    site?: {email:string;password:string};
    planner?: {email:string;password:string};
  }={};
  const createdIds:string[]=[];
  try{
    for(const role of ["site","planner"] as const){
      // Both roles share the same readable short workspace alias while
      // server-side authorization still uses the full UUID.
      const {email,password:secret}=makeEvaluatorCredentials(workspace.workspace_id,role);
      const {data:created,error:createError}=await admin.auth.admin.createUser({
        email,password:secret,email_confirm:true,
        app_metadata:{source:"sih_evaluator",evaluator_role:role},
      });
      if(createError||!created?.user?.id)throw new Error("Auth provisioning failed");
      const uid=created.user.id;
      createdIds.push(uid);
      const {error:accessError}=await admin.from("evaluator_accounts").insert({
        user_id:uid,role,workspace_id:workspace.workspace_id,expires_at:workspace.expires_at,
      });
      if(accessError)throw new Error("Workspace assignment failed");
      const {error:roleError}=await admin.from("user_roles").insert({user_id:uid,role});
      if(roleError)throw new Error("Role assignment failed");
      accounts[role]={email,password:secret};
    }
    const {data:roles,error:checkError}=await admin.from("evaluator_accounts")
      .select("role").eq("workspace_id",workspace.workspace_id);
    if(checkError||!roles||roles.length!==2 ||
      roles.filter(x=>x.role==="site").length!==1 ||
      roles.filter(x=>x.role==="planner").length!==1)
      throw new Error("Incomplete demo account pair");
    return reply({mode:"real_authenticated",expiresAt:workspace.expires_at,
      site:accounts.site,planner:accounts.planner},200,origin);
  }catch{
    // Delete partially generated Auth accounts. Fail closed; never deliver one
    // usable credential if both roles were not provisioned and verified.
    for(const uid of createdIds.reverse()){
      try{await admin.auth.admin.deleteUser(uid);}catch{/* no secret in logs */}
    }
    await admin.from("evaluator_workspaces").delete().eq("id",workspace.workspace_id);
    return reply({error:"Could not create this demo workspace. Please retry."},503,origin);
  }
});
