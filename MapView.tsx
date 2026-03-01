import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // ¡No olvides importar el CSS!
import { Delivery, DeliveryStatus, DeliveryType } from './types';

interface MapViewProps {
  deliveries: Delivery[];
  manualSequence: string[];
  selectedId: string | null;
  onMarkerClick: (id: string, forceExpand?: boolean) => void;
  viewMode: string;
}

const MapView: React.FC<MapViewProps> = ({
  deliveries,
  manualSequence,
  selectedId,
  onMarkerClick,
  viewMode,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isValidLatLng = (coords: any): coords is [number, number] => {
    return (
      Array.isArray(coords) &&
      coords.length === 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number' &&
      !isNaN(coords[0]) &&
      !isNaN(coords[1]) &&
      isFinite(coords[0]) &&
      isFinite(coords[1])
    );
  };

  // 1. Inicialización Única con Limpieza
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      fadeAnimation: true,
      markerZoomAnimation: true,
    }).setView([40.4168, -3.7126], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    // LIMPIEZA: Fundamental para evitar el error "Map container is already initialized"
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Invalidate Size (Manejo de redimensionado)
  useEffect(() => {
    if (!mapRef.current) return;
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 300);
    return () => clearTimeout(timer);
  }, [viewMode]);

  // 3. Dibujado de Marcadores y Rutas
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Limpiar marcadores
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    // Limpiar polilínea
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    const validDeliveries = deliveries.filter(d => isValidLatLng(d.coordinates));

    // Dibujar Polilínea (Ruta)
    if (manualSequence.length >= 2) {
      const routePoints = manualSequence
        .map(id => validDeliveries.find(d => d.id === id)?.coordinates)
        .filter((coords): coords is [number, number] => isValidLatLng(coords));

      if (routePoints.length >= 2) {
        polylineRef.current = L.polyline(routePoints, {
          color: '#3b82f6',
          weight: 4,
          opacity: 0.6,
          dashArray: '8, 12',
          lineJoin: 'round',
        }).addTo(map);
      }
    }

    // Crear Marcadores
    validDeliveries.forEach((delivery) => {
      const isSelected = selectedId === delivery.id;
      const sequenceIndex = manualSequence.indexOf(delivery.id);
      const isOrdered = sequenceIndex !== -1;

      // Lógica de colores (tu lógica original mantenida)
      let color = '#3b82f6';
      if (delivery.status === DeliveryStatus.COMPLETED) color = '#10b981';
      else if (delivery.status === DeliveryStatus.ISSUE) color = '#eab308';
      else if (delivery.type === DeliveryType.PICKUP) color = '#ef4444';

      const size = isSelected ? 34 : 28;
      
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="
            background-color: ${color};
            width: ${size}px;
            height: ${size}px;
            border-radius: 10px;
            border: 3px solid white;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: ${isSelected ? '14px' : '11px'};
            font-weight: 900;
            transform: ${isSelected ? 'scale(1.15)' : 'scale(1)'};
            transition: transform 0.2s ease;
          ">
            ${delivery.status === DeliveryStatus.COMPLETED ? '✓' : (isOrdered ? sequenceIndex + 1 : '')}
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker(delivery.coordinates as [number, number], { 
        icon,
        zIndexOffset: isSelected ? 1000 : (isOrdered ? 500 : 0)
      }).addTo(map);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onMarkerClick(delivery.id);
      });

      // Popup optimizado
      const popupHtml = `
        <div style="text-align: center; min-width: 100px;">
          <div style="font-weight: 800; font-size: 11px; text-transform: uppercase;">${delivery.recipient}</div>
          <div style="font-size: 9px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${delivery.address}</div>
        </div>
      `;
      marker.bindPopup(popupHtml, { offset: [0, -size / 2], closeButton: false });
      
      markersRef.current[delivery.id] = marker;
    });

    // Ajustar vista si no estamos en lista
    if (validDeliveries.length > 0 && viewMode !== 'list' && !selectedId) {
        const bounds = L.latLngBounds(validDeliveries.map(d => d.coordinates as [number, number]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [deliveries, manualSequence, viewMode]); // Eliminamos selectedId y onMarkerClick de aquí para evitar saltos innecesarios

  // 4. Efecto de "Vuelo" (FlyTo) independiente
  useEffect(() => {
    if (!selectedId || !mapRef.current || !markersRef.current[selectedId]) return;
    
    const marker = markersRef.current[selectedId];
    const latLng = marker.getLatLng();
    
    mapRef.current.flyTo(latLng, 16, { duration: 1.2 });
    marker.openPopup();
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-slate-100"
      style={{ minHeight: '300px', position: 'relative' }}
    />
  );
};

export default MapView;
