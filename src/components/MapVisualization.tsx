import { useState, useRef, useEffect } from 'react';
import { MapPin, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import type { MapCluster } from '../lib/supabase';
import ClusterPopover from './ClusterPopover';
import L from 'leaflet';

// Fix for default Leaflet icons in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapVisualizationProps {
  clusters: MapCluster[];
  loading: boolean;
  onViewInDirectory: (city: string, state: string, personIds: string[]) => void;
  onNavigate: (page: string, id?: string) => void;
}

const INITIAL_CENTER: [number, number] = [39.8283, -98.5795]; // US Center
const INITIAL_ZOOM = 4;

function MapController({ clusters, onMapClick }: { clusters: MapCluster[], onMapClick: () => void }) {
  const map = useMap();
  
  useEffect(() => {
    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [map, onMapClick]);

  return null;
}

export default function MapVisualization({ clusters, loading, onViewInDirectory, onNavigate }: MapVisualizationProps) {
  const [selectedCluster, setSelectedCluster] = useState<MapCluster | null>(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setSelectedCluster(null);
  }, [clusters]);

  const handleClusterClick = (cluster: MapCluster, e: L.LeafletMouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Use originalEvent for screen coordinates
    setPopoverPos({ 
      x: e.originalEvent.clientX - rect.left, 
      y: e.originalEvent.clientY - rect.top 
    });
    setSelectedCluster(cluster);
  };

  const handleBackdropClick = () => {
    setSelectedCluster(null);
  };

  const zoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const zoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const resetView = () => {
    mapRef.current?.setView(INITIAL_CENTER, INITIAL_ZOOM);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none"
      onClick={handleBackdropClick}
    >
      <div className="w-full h-full bg-slate-50 relative overflow-hidden">
        <MapContainer
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          style={{ height: '100%', width: '100%', background: '#f8fafc' }}
          zoomControl={false}
          attributionControl={false}
          ref={(map) => { mapRef.current = map; }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MapController clusters={clusters} onMapClick={handleBackdropClick} />

          {clusters.map((cluster) => {
            const count = cluster.people.length + cluster.organizations.length;
            // Radius calculation: base size + logarithmic growth for count
            const radius = Math.max(Math.sqrt(count) * 6, 8);
            const isSelected = selectedCluster?.city === cluster.city && selectedCluster?.state === cluster.state;

            return (
              <CircleMarker
                key={`${cluster.city}-${cluster.state}`}
                center={[cluster.lat, cluster.lng]}
                radius={radius}
                pathOptions={{
                  fillColor: isSelected ? '#D97706' : '#FACC15',
                  color: isSelected ? '#B45309' : '#EAB308',
                  weight: 2,
                  fillOpacity: 0.7,
                }}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleClusterClick(cluster, e);
                  },
                }}
              >
                {/* We could use Leaflet Tooltip here if we wanted labels on hover, 
                    but the user specifically asked to remove the permanent labels. */}
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Legend/Status */}
        <div className="absolute top-4 left-4 z-[1000] bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100 overflow-hidden pointer-events-none">
          <div className="px-4 py-3">
            <div className="flex items-center space-x-2 mb-1">
              <MapPin className="w-4 h-4 text-yellow-600" />
              <span className="font-semibold text-sm text-gray-900">Network Map</span>
            </div>
            <p className="text-xs text-gray-500">
              {loading ? 'Refreshing map...' : `Showing ${clusters.length} locations`}
            </p>
          </div>
        </div>

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
                <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-medium text-gray-700">Loading map data...</span>
             </div>
          </div>
        )}

        {!loading && clusters.length === 0 && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg border border-gray-100">
              <span className="text-sm font-medium text-gray-500">No results match your filters</span>
            </div>
          </div>
        )}
      </div>

      {selectedCluster && (
        <ClusterPopover
          cluster={selectedCluster}
          position={popoverPos}
          containerRef={containerRef}
          onClose={() => setSelectedCluster(null)}
          onViewInDirectory={onViewInDirectory}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
