/** Cloudflare Turnstile, one interaction only if bot risk requires it.
 * Token must be verified server-side. No public signup works without the key.
 */
type TurnstileApi={
  render:(element:HTMLElement, options:Record<string,unknown>)=>string;
  execute:(widget:string)=>void;
  remove:(widget:string)=>void;
};
declare global { interface Window { turnstile?:TurnstileApi } }
let pendingScript:Promise<void>|null=null;
async function loadTurnstile():Promise<void>{
  if(window.turnstile)return;
  if(!pendingScript)pendingScript=new Promise<void>((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.crossOrigin="anonymous";
    script.onload=()=>resolve();
    script.onerror=()=>{pendingScript=null;reject(new Error("Bot protection could not load. Check your network."));};
    document.head.appendChild(script);
  });
  await pendingScript;
  if(!window.turnstile)throw new Error("Bot protection is unavailable in this browser.");
}
export async function evaluatorProof():Promise<string>{
  const sitekey=import.meta.env.VITE_EVALUATOR_TURNSTILE_SITE_KEY?.trim();
  if(!sitekey)throw new Error("Evaluator registration needs a Turnstile site key configured by SETU.");
  await loadTurnstile();
  const turnstile=window.turnstile!;
  const node=document.createElement("div");
  node.setAttribute("aria-label","Evaluator security verification");
  Object.assign(node.style,{position:"fixed",bottom:"16px",right:"16px",zIndex:"9999"});
  document.body.appendChild(node);
  return await new Promise<string>((resolve,reject)=>{
    let widget:string|undefined;
    let finished=false;
    const timeout=window.setTimeout(()=>settle(new Error("Security verification timed out. Try again.")),90000);
    function settle(result:string|Error){
      if(finished)return;
      finished=true;
      window.clearTimeout(timeout);
      if(widget){try{turnstile.remove(widget);}catch{/*already removed*/}}
      node.remove();
      if(result instanceof Error)reject(result);
      else resolve(result);
    }
    try{
      widget=turnstile.render(node,{
        sitekey,action:"setu_evaluator",appearance:"interaction-only",execution:"execute",
        callback:(token:unknown)=>typeof token==="string" && token ? settle(token):
          settle(new Error("Security verification did not return a token.")),
        "error-callback":()=>settle(new Error("Security challenge failed. Try again.")),
        "timeout-callback":()=>settle(new Error("Security check timed out.")),
      });
      turnstile.execute(widget);
    }catch{settle(new Error("Could not start security verification."));}
  });
}
