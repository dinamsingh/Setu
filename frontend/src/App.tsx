import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DemoSandbox } from './pages/demo/DemoSandbox';

// Important: production Supabase/AuthContext modules MUST NOT load on /demo.
// Lazy-loading the authenticated app isolates credential-free demo traffic
// from Supabase session initialization and production role/data requests.
const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'));

export const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/demo" element={<DemoSandbox />} />
      <Route path="/*" element={
        <Suspense fallback={<div role="status" className="p-6">Opening SETU...</div>}>
          <AuthenticatedApp />
        </Suspense>
      } />
    </Routes>
  </BrowserRouter>
);

export default App;
