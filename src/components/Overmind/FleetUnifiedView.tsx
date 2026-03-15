import { useState } from 'react';
import { FleetsView } from './FleetsView';
import { FleetView } from './FleetView';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface FleetUnifiedViewProps {
  lastEvent?: OvermindEvent | null;
}

type FleetSection = 'machines' | 'workers';

export function FleetUnifiedView({ lastEvent }: FleetUnifiedViewProps) {
  const [section, setSection] = useState<FleetSection>('machines');

  return (
    <div className="h-full flex flex-col">
      {/* Section toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.04] bg-slate-900/30">
        <button
          onClick={() => setSection('machines')}
          className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
            section === 'machines'
              ? 'bg-white/[0.08] text-white'
              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
          }`}
        >
          Machines
        </button>
        <button
          onClick={() => setSection('workers')}
          className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
            section === 'workers'
              ? 'bg-white/[0.08] text-white'
              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
          }`}
        >
          Workers
        </button>
        <span className="ml-auto text-[10px] text-slate-600">
          Includes local + remote fleets
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {section === 'machines' && <FleetsView lastEvent={lastEvent} />}
        {section === 'workers' && <FleetView lastEvent={lastEvent} />}
      </div>
    </div>
  );
}
