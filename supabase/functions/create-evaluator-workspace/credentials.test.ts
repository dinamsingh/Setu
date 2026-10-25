import { makeEvaluatorCredentials } from "./credentials.ts";

const id="26afe3a8-b8ed-4c19-81ca-ad81da6982a0";
Deno.test("readable account aliases share workspace suffix but never cross roles",()=>{
 const site=makeEvaluatorCredentials(id,"site");
 const planner=makeEvaluatorCredentials(id,"planner");
 if(site.email!=="supervisor-26afe3a8b8ed@setu.invalid")throw Error("Supervisor alias format changed");
 if(planner.email!=="planner-26afe3a8b8ed@setu.invalid")throw Error("Planner alias format changed");
 if(site.password===planner.password)throw Error("Both roles received identical password");
});
Deno.test("demo passwords are human-readable with 16 random unambiguous symbols",()=>{
 for(let i=0;i<100;i++){
  const p=makeEvaluatorCredentials(id,"site").password;
  if(!/^SETU-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/.test(p))
   throw Error("Password is not readable or does not contain 80 bits");
 }
});
Deno.test("different invocations generate unique secure credentials",()=>{
 const unique=new Set<string>();
 for(let i=0;i<1000;i++){
  const p=makeEvaluatorCredentials(id,"site").password;
  if(unique.has(p))throw Error("Duplicate password");
  unique.add(p);
 }
});
Deno.test("invalid workspace aliases are rejected",()=>{
 let failed=false;
 try{makeEvaluatorCredentials("not-a-uuid","planner");}catch{failed=true;}
 if(!failed)throw Error("Workspace ID validation bypassed");
});
