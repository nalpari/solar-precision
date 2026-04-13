import { SideNav } from "@/components/SideNav";
import { SiteMap } from "@/components/SiteMap";
import { CoordinatesBentoCard } from "@/components/TargetCoordinates";

function DetectionStatusModule() {
  return (
    <div className="bg-surface-container rounded-xl p-4 border border-outline-variant/15">
      <div className="flex items-center gap-3 mb-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
        </span>
        <span className="font-label text-[10px] font-bold uppercase tracking-widest text-primary">
          System Ready
        </span>
      </div>
      <p className="font-body text-xs text-on-surface leading-relaxed mb-4">
        Waiting for input...
      </p>
      <div className="space-y-2">
        <div className="flex justify-between items-center text-[10px] font-mono text-tertiary">
          <span>LATENCY</span>
          <span>12ms</span>
        </div>
        <div className="w-full bg-outline-variant/20 h-1 rounded-full overflow-hidden">
          <div className="bg-primary h-full w-1/3" />
        </div>
      </div>
    </div>
  );
}

export default function DetectPage() {
  return (
    <>
      <SideNav footer={<DetectionStatusModule />} />
      <main className="pl-80 pt-14 h-screen w-full relative overflow-hidden">
        <SiteMap tint="primary" />

        {/* Central reticle + tooltip */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
          <div className="mb-4 glass-panel px-4 py-2.5 rounded-full border border-white/20 shadow-lg animate-bounce">
            <p className="text-xs font-medium text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-sm">
                info
              </span>
              인식할 건물 위로 지도를 이동하세요
            </p>
          </div>
          <div className="relative">
            <div className="absolute inset-0 scale-150 border-2 border-primary/40 rounded-full animate-ping" />
            <div className="relative w-8 h-8 flex items-center justify-center">
              <span className="material-symbols-outlined filled text-primary text-4xl">
                location_on
              </span>
              <div className="absolute -bottom-1 w-2 h-0.5 bg-black/20 blur-sm rounded-full" />
            </div>
          </div>
        </div>

        {/* Auto Detect CTA */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 pl-40">
          <button
            type="button"
            className="flex items-center gap-3 bg-primary text-on-primary px-8 py-4 rounded-full shadow-2xl hover:bg-primary-container transition-all transform hover:scale-105 group"
          >
            <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">
              document_scanner
            </span>
            <span className="font-headline font-extrabold text-lg tracking-tight">
              자동 지붕 인식 (Auto Detect)
            </span>
          </button>
        </div>

        {/* Right bento panels */}
        <div className="absolute right-6 top-20 flex flex-col gap-4 z-20 w-72">
          <CoordinatesBentoCard />

          <div className="glass-panel p-2 rounded-xl flex flex-col gap-1 shadow-sm border border-outline-variant/10">
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">layers</span>
              <span className="text-[11px] font-medium">Map Layers</span>
            </button>
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">
                3d_rotation
              </span>
              <span className="text-[11px] font-medium">3D View</span>
            </button>
            <button className="p-2 hover:bg-white rounded-lg transition-colors flex items-center gap-3 text-slate-600">
              <span className="material-symbols-outlined text-lg">
                straighten
              </span>
              <span className="text-[11px] font-medium">Measure</span>
            </button>
          </div>

          <div className="glass-panel p-4 rounded-xl shadow-sm border border-outline-variant/10">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-primary">
                wb_sunny
              </span>
              <div>
                <p className="text-[10px] font-bold text-tertiary uppercase">
                  Insolation
                </p>
                <p className="text-sm font-bold">5.2 kWh/m²</p>
              </div>
            </div>
          </div>
        </div>

        {/* Zoom / locate */}
        <div className="absolute right-6 bottom-10 flex flex-col gap-2 z-20">
          <div className="flex flex-col bg-white rounded-lg shadow-lg overflow-hidden border border-outline-variant/15">
            <button className="p-2.5 hover:bg-surface-container transition-colors border-b border-outline-variant/10">
              <span className="material-symbols-outlined text-xl">add</span>
            </button>
            <button className="p-2.5 hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-xl">remove</span>
            </button>
          </div>
          <button className="bg-white p-2.5 rounded-lg shadow-lg border border-outline-variant/15 hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-xl">
              my_location
            </span>
          </button>
        </div>

        {/* Scale bar */}
        <div className="absolute bottom-6 left-6 z-20 flex items-center gap-4 pl-80">
          <div className="glass-panel px-3 py-1 rounded border border-white/20 shadow-sm flex items-center gap-3">
            <div className="w-12 h-0.5 bg-on-surface-variant relative">
              <div className="absolute -left-0.5 -top-1 w-1 h-2 bg-on-surface-variant" />
              <div className="absolute -right-0.5 -top-1 w-1 h-2 bg-on-surface-variant" />
            </div>
            <span className="font-mono text-[10px] font-bold text-on-surface-variant">
              20m
            </span>
          </div>
          <div className="glass-panel px-3 py-1 rounded border border-white/20 shadow-sm">
            <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase">
              Google Satellite Hybrid
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
