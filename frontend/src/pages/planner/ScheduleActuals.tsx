import React from 'react';
import { CalendarRange, Database, LockKeyhole } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';

export const ScheduleActuals: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-[90rem]">
          <section className="border-l-4 border-setu-blue bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-xs">
            <p className="text-xs font-semibold tracking-[0.14em] text-setu-blue uppercase">
              Schedule control
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-setu-slate-900">
              Schedule Actuals
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-setu-slate-600">
              Approved field events will form a controlled actuals overlay without changing the imported baseline.
            </p>
          </section>

          <section className="mt-5 border border-setu-slate-200 bg-white">
            <div className="grid min-h-[28rem] place-items-center px-6 py-14 text-center">
              <div className="max-w-xl">
                <div className="mx-auto flex h-12 w-12 items-center justify-center border border-setu-slate-300 bg-setu-slate-50 text-setu-blue">
                  <CalendarRange className="h-6 w-6" />
                </div>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-setu-slate-500">
                  Phase boundary
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-setu-slate-900">
                  No approved schedule actuals exist yet
                </h2>
                <p className="mt-3 text-sm leading-6 text-setu-slate-600">
                  Approved START, FINISH, and PROGRESS events will appear here after event extraction and planner-governed schedule overlay work is implemented.
                </p>

                <div className="mt-6 flex items-start gap-3 border-l-4 border-setu-amber bg-amber-50 px-4 py-3 text-left text-xs text-amber-950">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    No dates, progress values, charts, or activity rows are inferred on this screen. Primavera and MS Project baselines remain read-only.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => navigate('/planner/onboarding')}
                  className="mt-6 inline-flex items-center gap-2 border border-setu-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-setu-slate-700 transition-colors hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                >
                  <Database className="h-4 w-4" />
                  Open baseline index / CSV preview
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};
