// src/MapView.tsx
import React from 'react';
import { Delivery } from './types';

type ViewMode = 'split' | 'map' | 'list';

interface MapViewProps {
  deliveries: Delivery[];
  manualSequence: string[];
  selectedId: string | null;
  onMarkerClick: (id: string) => void;
  viewMode: ViewMode;
}

const MapView: React.FC<MapViewProps> = ({
  deliveries,
  manualSequence,
  selectedId,
  onMarkerClick,
  viewMode,
}) => {
  // Aquí luego meterás tu lógica real del mapa (Google Maps, Leaflet, etc.)
  // De momento dejamos un placeholder simple.
  return (
    <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold uppercase tracking-widest italic">
      MAPA AQUÍ
    </div>
  );
};

export default MapView;
