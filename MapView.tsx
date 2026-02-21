
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
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

  useEffect(() => {
    if (!mapRef.current) {
      const mapContainer = document.getElementById('map-container');
      if (!mapContainer) return;

      mapRef.current = L.map(mapContainer, {
        zoomControl: false,
        fadeAnimation: true,
        markerZoomAnimation: true,
      }).setView([40.4168, -3.7126], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapRef.current);

      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }
  }, []);

  // Arregla problemas de tamaño del mapa al cambiar de vista / móvil
  useEffect(() => {
    if (!mapRef.current) return;
    const timer = setTimeout(() => {
      try {
        mapRef.current!.invalidateSize({ animate: true });
      } catch (e) {
        console.warn('Invalidate size failed', e);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [viewMode]);

  // Pintar marcadores y ruta
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Limpia marcadores anteriores
    Object.values(markersRef.current).forEach((m) => {
      try {
        m.remove();
      } catch (e) {
        console.warn('Error removing marker', e);
      }
    });
    markersRef.current = {};

    // Limpia polilínea anterior
    if (polylineRef.current) {
      try {
        polylineRef.current.remove();
      } catch {}
      polylineRef.current = null;
    }

    const validDeliveries = deliveries.filter((d) => isValidLatLng(d.coordinates));

    console.log('MapView deliveries:', deliveries);
    console.log(
      'Valid deliveries for map:',
      validDeliveries.map((d) => ({ id: d.id, coords: d.coordinates, address: d.address }))
    );

    // Dibuja la ruta si hay secuencia manual
    if (manualSequence.length >= 2) {
      const routePoints = manualSequence
        .map((id) => validDeliveries.find((d) => d.id === id)?.coordinates)
        .filter((coords): coords is [number, number] => isValidLatLng(coords));

      if (routePoints.length >= 2) {
        try {
          polylineRef.current = L.polyline(routePoints, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.7,
            dashArray: '12, 12',
            lineJoin: 'round',
          }).addTo(map);
        } catch (e) {
          console.warn('Error drawing polyline', e);
        }
      }
    }

    // Crear marcadores
    validDeliveries.forEach((delivery) => {
      if (!isValidLatLng(delivery.coordinates)) return;

      let color = '#3b82f6';
      if (delivery.status === DeliveryStatus.COMPLETED) color = '#10b981';
      else if (delivery.status === DeliveryStatus.ISSUE) color = '#eab308';
      else if (delivery.type === DeliveryType.PICKUP) color = '#ef4444';

      const isSelected = selectedId === delivery.id;
      const sequenceIndex = manualSequence.indexOf(delivery.id);
      const isOrdered = sequenceIndex !== -1;

      const size = isSelected ? 34 : isOrdered ? 30 : 24;
      const borderSize = isSelected ? '4px' : '3px';

      const icon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="
            background-color: ${color};
            width: ${size}px;
            height: ${size}px;
            border-radius: 12px;
            border: ${borderSize} solid white;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: ${isSelected ? '14px' : '12px'};
            font-weight: 900;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            transform: scale(${isSelected ? 1.1 : 1});
          ">
            ${isOrdered && delivery.status !== DeliveryStatus.COMPLETED ? sequenceIndex + 1 : ''}
            ${delivery.status === DeliveryStatus.COMPLETED ? '✓' : ''}
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      try {
        const marker = L.marker(delivery.coordinates, {
          icon,
          zIndexOffset: isSelected ? 1000 : 0,
        }).addTo(map);

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onMarkerClick(delivery.id);
        });

        const popupContent = document.createElement('div');
        popupContent.className = 'p-1';
        popupContent.innerHTML = `
          <div class="font-black text-[11px] mb-0.5 uppercase tracking-tight">${delivery.recipient}</div>
          <div class="text-[9px] text-slate-400 font-bold truncate max-w-[120px] uppercase">${delivery.address}</div>
        `;

        marker.bindPopup(popupContent, { offset: [0, -size / 2], closeButton: false });
        markersRef.current[delivery.id] = marker;
      } catch (e) {
        console.error('Error creating marker', e);
      }
    });

    // Ajustar el mapa a todos los puntos
    if (validDeliveries.length > 0 && viewMode !== 'list') {
      try {
        const validCoords = validDeliveries
          .map((d) => d.coordinates)
          .filter((c) => isValidLatLng(c));
        if (validCoords.length === 1) {
          map.setView(validCoords[0], 16);
        } else if (validCoords.length > 1) {
          const bounds = L.latLngBounds(validCoords);
          map.fitBounds(bounds, { padding: [100, 100], maxZoom: 16 });
        }
      } catch (e) {
        console.warn('Could not fit bounds', e);
      }
    }
  }, [deliveries, manualSequence, onMarkerClick, viewMode, selectedId]);

  // Volar al marcador seleccionado
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const marker = markersRef.current[selectedId];
    if (!marker) return;

    try {
      const latLng = marker.getLatLng();
      if (!latLng || isNaN(latLng.lat) || isNaN(latLng.lng)) return;

      mapRef.current.flyTo(latLng, 16, { duration: 1 });
      marker.openPopup();
    } catch (e) {
      console.warn('FlyTo failed', e);
    }
  }, [selectedId]);

  return (
    <div
      id="map-container"
      className="h-full w-full bg-slate-100"
      style={{ minHeight: '300px' }}
    />
  );
};

export default MapView;
