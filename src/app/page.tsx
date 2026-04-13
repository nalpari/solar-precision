import { SideNav } from "@/components/SideNav";
import { SiteMap } from "@/components/SiteMap";
import { TargetCoordinatesCard } from "@/components/TargetCoordinates";

export default function SiteAnalysisPage() {
  return (
    <div className="flex h-screen pt-14">
      <SideNav />
      <main className="flex-1 relative overflow-hidden ml-80">
        <SiteMap tint="fade" />

        {/* Center pin */}
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none pb-12">
          <div className="relative flex flex-col items-center">
            <span className="material-symbols-outlined filled text-error text-5xl drop-shadow-lg">
              location_on
            </span>
            <div className="w-2 h-2 bg-black/20 rounded-full blur-[1px] mt-1 scale-x-150" />
          </div>
        </div>

        {/* Left-side overlay stack */}
        <div className="absolute top-6 left-6 z-20 flex flex-col gap-4 max-w-xs">
          <TargetCoordinatesCard />

          <div className="glass-panel p-2 rounded-xl shadow-lg inline-flex flex-col gap-2 w-fit">
            <button className="p-3 hover:bg-surface-container rounded-lg text-on-surface-variant transition-colors">
              <span className="material-symbols-outlined">layers</span>
            </button>
            <div className="h-px bg-outline-variant/20 mx-2" />
            <button className="p-3 hover:bg-surface-container rounded-lg text-on-surface-variant transition-colors">
              <span className="material-symbols-outlined">straighten</span>
            </button>
            <button className="p-3 hover:bg-surface-container rounded-lg text-on-surface-variant transition-colors">
              <span className="material-symbols-outlined">3d_rotation</span>
            </button>
          </div>
        </div>

        {/* Bottom-right cluster */}
        <div className="absolute bottom-6 right-6 z-20 flex gap-4">
          <div className="glass-panel px-4 py-3 rounded-full shadow-lg flex items-center gap-3">
            <span className="material-symbols-outlined filled text-primary">
              wb_sunny
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] text-outline font-bold uppercase">
                Solar Yield Est.
              </span>
              <span className="text-sm font-bold font-mono">1,420 kWh/kWp</span>
            </div>
          </div>

          <div className="glass-panel p-2 rounded-xl shadow-lg flex flex-col gap-2">
            <button className="p-2 hover:bg-surface-container rounded-lg text-on-surface-variant">
              <span className="material-symbols-outlined">add</span>
            </button>
            <button className="p-2 hover:bg-surface-container rounded-lg text-on-surface-variant">
              <span className="material-symbols-outlined">remove</span>
            </button>
            <button className="p-2 hover:bg-surface-container rounded-lg text-primary">
              <span className="material-symbols-outlined">my_location</span>
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 z-20 glass-panel p-4 rounded-xl shadow-lg max-w-[200px]">
          <h4 className="text-[10px] font-bold text-outline mb-3 uppercase tracking-widest">
            Analysis Layers
          </h4>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-primary rounded-[2px]" />
              <span className="text-xs font-medium text-slate-700">
                Optimal PV Placement
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-inverse-on-surface border border-outline-variant rounded-[2px]" />
              <span className="text-xs font-medium text-slate-700">
                Shadow Obstacles
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-error rounded-[2px]" />
              <span className="text-xs font-medium text-slate-700">
                No-Go Zones
              </span>
            </div>
          </div>
        </div>

        {/* CTA to detect screen */}
        <div className="absolute top-6 right-6 z-20">
          <a
            href="/detect"
            className="flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-full shadow-lg hover:bg-primary-container transition-colors text-xs font-bold tracking-tight"
          >
            <span className="material-symbols-outlined text-base">
              document_scanner
            </span>
            Auto Detect
          </a>
        </div>
      </main>
    </div>
  );
}
