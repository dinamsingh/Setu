
import { Code2, GitBranch, Terminal } from 'lucide-react';

export default function Technology() {
  const githubUrl = import.meta.env.VITE_GITHUB_URL || 'https://github.com/dinamsingh/Setu';

  const stack = [
    { name: 'React', desc: 'UI Framework' },
    { name: 'TypeScript', desc: 'Type Safety' },
    { name: 'Vite', desc: 'Build Tooling' },
    { name: 'Tailwind CSS', desc: 'Styling' },
  ];

  return (
    <section id="technology" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          
          {/* Tech Stack */}
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-primary mb-6">
              Built for Practical Deployment
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-8">
              {stack.map((tech) => (
                <div key={tech.name} className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-semibold text-slate-800">{tech.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{tech.desc}</div>
                </div>
              ))}
            </div>
            
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-5">
              <h3 className="text-sm font-bold text-blue-900 mb-2 flex items-center">
                <GitBranch className="w-4 h-4 mr-2" />
                Engineered with real project context
              </h3>
              <p className="text-sm text-blue-800 leading-relaxed">
                Designed to complement Primavera/P6-style schedule workflows, structured project planning, and human-in-the-loop validation without disrupting existing systems.
              </p>
            </div>
          </div>

          {/* GitHub / Project */}
          <div className="bg-slate-900 rounded-2xl p-10 text-white shadow-xl relative overflow-hidden">
            <div className="absolute -right-10 -top-10 opacity-5">
              <Terminal className="w-64 h-64" />
            </div>
            
            <Code2 className="w-10 h-10 text-slate-400 mb-6 relative z-10" />
            <h2 className="text-2xl font-bold mb-4 relative z-10">Project Repository</h2>
            <p className="text-slate-400 mb-8 relative z-10 leading-relaxed max-w-md">
              Source code, prototype implementation, documentation, and benchmark material are available for SIH evaluators.
            </p>
            
            <div className="relative z-10">
              {githubUrl ? (
                <a 
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center px-6 py-3 border border-slate-700 text-sm font-semibold rounded-md text-white bg-slate-800 hover:bg-slate-700 transition-colors shadow-sm"
                >
                  <Terminal className="w-4 h-4 mr-2" />
                  View on GitHub
                </a>
              ) : (
                <button disabled className="inline-flex items-center justify-center px-6 py-3 border border-slate-700 text-sm font-semibold rounded-md text-slate-500 bg-slate-800/50 cursor-not-allowed">
                  <Terminal className="w-4 h-4 mr-2 opacity-50" />
                  GitHub URL Not Configured
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
