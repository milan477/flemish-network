import { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import type { MapCluster } from '../lib/supabase';
import ClusterPopover from './ClusterPopover';
import L from 'leaflet';

// Leaflet styles for clustering (not included in default leaflet.css)
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fix for default Leaflet icons in Vite
delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapVisualizationProps {
  clusters: MapCluster[];
  loading: boolean;
  fullDataReady: boolean;
  focusedCity: { city: string; state: string } | null;
  onViewInDirectory: (city: string, state: string, personIds: string[]) => void;
  onNavigate: (page: string, id?: string) => void;
  totalPeople: number;
  totalOrganizations: number;
}

const INITIAL_CENTER: [number, number] = [39.8283, -98.5795]; // US Center
const INITIAL_ZOOM = 4;
const MAX_CIRCLE_SCALE_COUNT = 25;

function MapController({ onMapClick }: { onMapClick: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onMapClick);
    return () => { map.off('click', onMapClick); };
  }, [map, onMapClick]);
  return null;
}

export default function MapVisualization({
  clusters,
  loading,
  fullDataReady,
  focusedCity,
  onViewInDirectory,
  onNavigate,
  totalPeople,
  totalOrganizations,
}: MapVisualizationProps) {
  const [selectedCityKey, setSelectedCityKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setSelectedCityKey(null);
  }, [clusters]);

  useEffect(() => {
    if (!focusedCity || !mapRef.current) return;

    const targetCluster = clusters.find(
      (cluster) =>
        cluster.city === focusedCity.city && cluster.state === focusedCity.state
    );

    if (!targetCluster) return;

    mapRef.current.setView([targetCluster.lat, targetCluster.lng], 9, {
      animate: true,
    });
    setSelectedCityKey(`${targetCluster.city}-${targetCluster.state}`);
  }, [clusters, focusedCity]);

  const handleBackdropClick = useCallback(() => {
    setSelectedCityKey(null);
  }, []);

  const zoomIn = () => { mapRef.current?.zoomIn(); };
  const zoomOut = () => { mapRef.current?.zoomOut(); };
  const resetView = () => { mapRef.current?.setView(INITIAL_CENTER, INITIAL_ZOOM); };
  const totalResults = totalPeople + totalOrganizations;

  // Custom icon for a single city cluster
  const createCityIcon = useCallback((cluster: MapCluster) => {
    const key = `${cluster.city}-${cluster.state}`;
    const count =
      (cluster.personCount ?? cluster.people.length) +
      (cluster.orgCount ?? cluster.organizations.length);
    const scaledCount = Math.min(count, MAX_CIRCLE_SCALE_COUNT);
    const size = Math.max(Math.sqrt(scaledCount) * 12, 32);
    const isSelected = selectedCityKey === key;
    
    return L.divIcon({
      html: `
        <div class="relative flex items-center justify-center group" style="width: ${size}px; height: ${size}px;">
          <div class="absolute inset-0 rounded-full transition-all duration-300 ${isSelected ? 'bg-amber-600 scale-110 shadow-lg' : 'bg-yellow-400 group-hover:bg-yellow-500 shadow-md'}" style="opacity: 0.9;"></div>
          <div class="absolute inset-0 rounded-full border-2 ${isSelected ? 'border-amber-700' : 'border-yellow-600'}" style="opacity: 0.5;"></div>
          <span class="relative z-10 text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-900'} pointer-events-none">${count}</span>
        </div>
      `,
      className: 'custom-city-icon',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, [selectedCityKey]);

  // Custom icon for merged clusters (multiple cities)
  const createClusterIcon = useCallback((cluster: L.MarkerCluster) => {
    const markers = cluster.getAllChildMarkers();
    let totalCount = 0;
    
    markers.forEach(m => {
      const mc = (m.options as L.MarkerOptions & { mapCluster?: MapCluster }).mapCluster;
      if (mc) {
        totalCount +=
          (mc.personCount ?? mc.people.length) +
          (mc.orgCount ?? mc.organizations.length);
      }
    });

    const scaledCount = Math.min(totalCount, MAX_CIRCLE_SCALE_COUNT);
    const size = Math.max(Math.sqrt(scaledCount) * 10, 40);
    
    return L.divIcon({
      html: `
        <div class="relative flex items-center justify-center group" style="width: ${size}px; height: ${size}px;">
          <div class="absolute inset-0 rounded-full bg-amber-500 shadow-lg border-2 border-amber-600 animate-pulse-slow"></div>
          <span class="relative z-10 text-xs font-bold text-white pointer-events-none">${totalCount}</span>
        </div>
      `,
      className: 'custom-merged-icon',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 select-none">
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s infinite ease-in-out;
        }
        .custom-city-icon, .custom-merged-icon {
          background: none !important;
          border: none !important;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        
        .leaflet-popup-content-wrapper {
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          width: auto !important;
        }
        .leaflet-popup-tip-container { display: none !important; }
        .leaflet-popup-close-button { display: none !important; }
      `}</style>
      
      <div className="w-full h-full bg-slate-50 relative overflow-hidden">
        <MapContainer
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          maxZoom={18}
          style={{ height: '100%', width: '100%', background: '#f8fafc' }}
          zoomControl={false}
          attributionControl={false}
          ref={(map) => { mapRef.current = map; }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          
          <MapController onMapClick={handleBackdropClick} />

          <MarkerClusterGroup
            chunkedLoading
            iconCreateFunction={createClusterIcon}
            showCoverageOnHover={false}
            maxClusterRadius={40}
          >
            {clusters.map((cluster) => {
              const key = `${cluster.city}-${cluster.state}`;
              return (
                <Marker
                  key={key}
                  position={[cluster.lat, cluster.lng]}
                  icon={createCityIcon(cluster)}
                  {...({ mapCluster: cluster } satisfies { mapCluster: MapCluster })}
                  eventHandlers={{
                    popupopen: () => setSelectedCityKey(key),
                    popupclose: () => setSelectedCityKey(null),
                  }}
                >
                  <Popup 
                    offset={[0, -12]}
                    autoPanPaddingTopLeft={[40, 140]} // 140px clearance from top
                    autoPanPaddingBottomRight={[40, 40]}
                    minWidth={320}
                    autoPan={true}
                  >
                    <ClusterPopover
                      cluster={cluster}
                      fullDataReady={fullDataReady}
                      onClose={() => mapRef.current?.closePopup()}
                      onViewInDirectory={onViewInDirectory}
                      onNavigate={onNavigate}
                    />
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>

        {/* Custom Zoom Controls */}
        <div className="absolute bottom-6 right-6 z-[1000] flex flex-col items-center space-y-2">
          <button
            onClick={(e) => { e.stopPropagation(); zoomIn(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors active:scale-95"
            title="Zoom In"
          >
            <ZoomIn className="w-5 h-5 text-gray-700" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); zoomOut(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors active:scale-95"
            title="Zoom Out"
          >
            <ZoomOut className="w-5 h-5 text-gray-700" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); resetView(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors mt-2 active:scale-95"
            title="Reset View"
          >
            <Maximize2 className="w-5 h-5 text-gray-700" />
          </button>
        </div>

        {/* Loading Overlay */}
        {loading && clusters.length === 0 && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
             <div className="bg-white px-6 py-3 rounded-full shadow-xl flex items-center space-x-3 border border-gray-100">
                <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-medium text-gray-700">Loading map data...</span>
             </div>
          </div>
        )}

        {!loading && clusters.length === 0 && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg border border-gray-100">
              <span className="text-sm font-medium text-gray-500">
                {totalResults > 0
                  ? `${totalResults} matching result${totalResults === 1 ? '' : 's'} found, but none have a mapped location yet`
                  : 'No results match your filters'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
