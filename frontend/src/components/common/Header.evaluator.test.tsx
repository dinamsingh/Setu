// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Header} from './Header';

const mocks=vi.hoisted(()=>({
 signOut:vi.fn(),refreshRole:vi.fn(),otherEvaluatorRole:vi.fn(),
 enterEvaluatorRole:vi.fn(),forgetEvaluatorAccess:vi.fn(),
}));
vi.mock('../../lib/AuthContext',()=>({
 useAuth:()=>({user:{email:'site@setu.invalid'},role:'site',
  signOut:mocks.signOut,refreshRole:mocks.refreshRole}),
}));
vi.mock('../../lib/evaluatorAccess',()=>({
 otherEvaluatorRole:mocks.otherEvaluatorRole,
 enterEvaluatorRole:mocks.enterEvaluatorRole,
 forgetEvaluatorAccess:mocks.forgetEvaluatorAccess,
}));
let node:HTMLDivElement;
let root:Root;
function Path(){const l=useLocation();return <output data-testid="path">{l.pathname}</output>;}
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 vi.clearAllMocks();
 mocks.signOut.mockResolvedValue({error:null});
 mocks.otherEvaluatorRole.mockReturnValue('planner');
 node=document.createElement('div');document.body.appendChild(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
describe('Evaluator logout and role switching',()=>{
 it('logs out active Supervisor without clearing the other paired account',async()=>{
  await act(async()=>root.render(<MemoryRouter initialEntries={['/supervisor/capture']}>
   <Header currentRole="supervisor"/><Path/>
  </MemoryRouter>));
  const out=node.querySelector<HTMLButtonElement>('button[title="Sign out of SETU"]');
  expect(out).toBeTruthy();
  await act(async()=>{out!.click();});
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.forgetEvaluatorAccess).not.toHaveBeenCalled();
  expect(node.querySelector('[data-testid="path"]')?.textContent).toBe('/');
 });
});
