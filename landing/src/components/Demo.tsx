
import { PlayCircle } from 'lucide-react';

export default function Demo() {
  const videoUrl = import.meta.env.VITE_DEMO_VIDEO_URL;

  return (
    <section id="demo" className="py-24 bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            See SETU in Action
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Prototype demonstration using representative data.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="relative aspect-video bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-2xl group cursor-pointer">
            {videoUrl ? (
              <iframe
                src={videoUrl}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="SETU Demo"
              ></iframe>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800 hover:bg-slate-700 transition-colors">
                <PlayCircle className="w-16 h-16 text-slate-400 group-hover:text-white transition-colors mb-4" />
                <span className="text-slate-300 font-medium">Watch Full Demo (2 mins)</span>
              </div>
            )}
          </div>
          
          <div className="mt-8 text-center">
            <a 
              href={videoUrl || '#'} 
              target={videoUrl ? "_blank" : undefined}
              rel="noreferrer"
              className="inline-flex items-center justify-center px-8 py-3.5 border border-transparent text-base font-semibold rounded-md text-slate-900 bg-white hover:bg-slate-100 transition-colors shadow-sm"
            >
              Watch Full Demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
