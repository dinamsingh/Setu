// @vitest-environment jsdom
import { StrictMode,act } from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RoleSelection} from './RoleSelection';

const mocks=vi.hoisted(()=>({
 signIn:vi.fn(),refreshRole:vi.fn(),currentEvaluatorAccess:vi.fn(),
 enterEvaluatorRole:vi.fn(),createEvaluatorWorkspace:vi.fn(),evaluatorProof:vi.fn(),
}));
vi.mock('../lib/AuthContext',()=>({
 useAuth:()=>({signIn:mocks.signIn,refreshRole:mocks.refreshRole,sessionIssue:null}),
}));
vi.mock('../lib/evaluatorAccess',()=>({
 currentEvaluatorAccess:mocks.currentEvaluatorAccess,
 enterEvaluatorRole:mocks.enterEvaluatorRole,
 createEvaluatorWorkspace:mocks.createEvaluatorWorkspace,
}));
vi.mock('../lib/evaluatorChallenge',()=>({evaluatorProof:mocks.evaluatorProof}));

let root:Root;
let node:HTMLDivElement;
const accounts={
 mode:'real_authenticated' as const,
 expiresAt:new Date(Date.now()+48*3600000).toISOString(),
 site:{email:'demo-supervisor@evaluator.invalid',password:'s'.repeat(64)},
 planner:{email:'demo-planner@evaluator.invalid',password:'p'.repeat(64)},
};
function PathProbe(){const l=useLocation();return <output data-testid="path">{l.pathname}</output>;}
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 vi.clearAllMocks();
 mocks.currentEvaluatorAccess.mockReturnValue(null);
 mocks.evaluatorProof.mockResolvedValue('turnstile-proof');
 mocks.createEvaluatorWorkspace.mockResolvedValue(accounts);
 mocks.enterEvaluatorRole.mockResolvedValue(undefined);
 mocks.refreshRole.mockResolvedValue('site');
 node=document.createElement('div');
 document.body.appendChild(node);
 root=createRoot(node);
 window.history.replaceState(null,'','/');
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
async function render(){await act(async()=>root.render(
 <StrictMode><MemoryRouter initialEntries={['/']}><RoleSelection/><PathProbe/></MemoryRouter></StrictMode>
));}
async function click(name:string){
 const b=[...node.querySelectorAll('button')].find(x=>x.textContent?.trim()===name);
 expect(b,name).toBeTruthy();
 await act(async()=>b!.click());
}
describe('Open public SETU evaluator login with linked 48h account pair',()=>{

 it('places the evaluator CTA before email/password fields and the normal sign-in button',async()=>{
  await render();
  const demo=[...node.querySelectorAll('button')].find(x=>x.textContent?.trim()==='SIH Evaluator Login');
  const email=node.querySelector('#setu-email');
  const signIn=[...node.querySelectorAll('button')].find(x=>x.textContent?.includes('Sign in to SETU'));
  expect(demo && email && signIn).toBeTruthy();
  const firstPosition=demo!.compareDocumentPosition(email!);
  expect(firstPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(demo!.compareDocumentPosition(signIn!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 });

 it('creates real accounts for any visitor after server-verifiable Turnstile proof',async()=>{
  await render();
  expect(node.textContent).toContain('SIH Evaluator Login');
  await click('SIH Evaluator Login');
  expect(mocks.evaluatorProof).toHaveBeenCalledOnce();
  expect(mocks.createEvaluatorWorkspace).toHaveBeenCalledWith('turnstile-proof');
  expect(node.textContent).toContain('48 hours');
  expect(node.querySelector<HTMLInputElement>('input[aria-label="Supervisor demo email"]')?.value).toBe(accounts.site.email);
  expect(node.querySelector<HTMLInputElement>('input[aria-label="Planner demo email"]')?.value).toBe(accounts.planner.email);
 });
 it('does not generate accounts when bot proof cannot be obtained',async()=>{
  mocks.evaluatorProof.mockRejectedValue(new Error('Security verification failed'));
  await render();
  await click('SIH Evaluator Login');
  expect(node.textContent).toContain('Security verification failed');
  expect(mocks.createEvaluatorWorkspace).not.toHaveBeenCalled();
 });
 it('can sign in Supervisor of freshly generated pair',async()=>{
  await render();
  await click('SIH Evaluator Login');
  await click('Login as Supervisor');
  expect(mocks.enterEvaluatorRole).toHaveBeenCalledWith('site');
  expect(node.querySelector('[data-testid="path"]')?.textContent).toBe('/supervisor/capture');
 });

 it('automatically displays existing paired credentials on returning after logout',async()=>{
  mocks.currentEvaluatorAccess.mockReturnValue(accounts);
  await render();
  expect(node.querySelector<HTMLInputElement>('input[aria-label="Supervisor demo email"]')?.value)
    .toBe(accounts.site.email);
  expect(node.querySelector<HTMLInputElement>('input[aria-label="Planner demo email"]')?.value)
    .toBe(accounts.planner.email);
  expect(mocks.createEvaluatorWorkspace).not.toHaveBeenCalled();
  expect(node.textContent).toContain('Sign out of one role');
  expect(node.textContent).toContain('End demo');
 });

 it('shows both roles as compact rows, not two large stacked cards',async()=>{
  mocks.currentEvaluatorAccess.mockReturnValue(accounts);
  await render();
  expect(node.querySelectorAll('.setu-login-v2__evaluator-row').length).toBe(2);
  expect(node.querySelectorAll('.setu-login-v2__evaluator-enter-compact').length).toBe(2);
  expect(node.querySelectorAll('.setu-login-v2__evaluator-field').length).toBe(4);
 });

 it('reuses same active pair on this tab instead of creating unlimited accounts per click',async()=>{
  mocks.currentEvaluatorAccess.mockReturnValue(accounts);
  await render();
  await click('SIH Evaluator Login');
  expect(mocks.evaluatorProof).not.toHaveBeenCalled();
  expect(node.querySelector<HTMLInputElement>('input[aria-label="Planner demo email"]')?.value).toBe('demo-planner@evaluator.invalid');
 });
});
