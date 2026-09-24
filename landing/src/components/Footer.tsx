

export default function Footer() {
  return (
    <footer className="bg-slate-50 py-12 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center md:items-start gap-8 text-center md:text-left">
        
        <div>
          <h2 className="text-xl font-bold tracking-tight text-primary">SETU</h2>
          <p className="text-sm font-medium text-slate-500 mt-1 tracking-wide">
            Schedule • Execution • Tracking • Unification
          </p>
          <p className="text-xs text-slate-400 mt-4 max-w-xs">
            Smart Automation for Plan–Field Integration
          </p>
        </div>

        <div className="flex space-x-6 text-sm font-medium text-slate-600">
          <a href="#demo" className="hover:text-primary transition-colors">Demo</a>
          <a href="#prototype" className="hover:text-primary transition-colors">Prototype</a>
          <a href={import.meta.env.VITE_GITHUB_URL || 'https://github.com/dinamsingh/Setu'} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">GitHub</a>
        </div>

        <div className="text-sm font-semibold text-slate-400 flex flex-col md:items-end">
          <span>SIH 2026</span>
          <span>Oil India Limited</span>
        </div>

      </div>
    </footer>
  );
}
