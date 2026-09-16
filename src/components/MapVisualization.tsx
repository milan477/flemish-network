import { useState, useRef, useEffect, useCallback } from 'react';
import { Earth, Moon, Sun, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import type { MapCluster } from '../lib/supabase';
import ClusterPopover from './ClusterPopover';
import L from 'leaflet';

// Leaflet styles for clustering (not included in default leaflet.css)
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'maplibre-gl/dist/maplibre-gl.css';

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
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const MAP_THEME_STORAGE_KEY = 'flemish-network-map-theme';
const LIGHT_WATER_COLOR = '#e4e7e9';
const DARK_THEME_SOURCE_WATER_COLOR = '#adadad';
const MAP_LABEL_FONT = ['Noto Sans Regular'];

type BasemapProvider = 'openfreemap' | 'osm';
type MapTheme = 'light' | 'dark';

function getInitialMapTheme(): MapTheme {
  if (typeof window === 'undefined') return 'light';

  try {
    return window.localStorage.getItem(MAP_THEME_STORAGE_KEY) === 'dark'
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

function ApiFreeBasemap({
  provider,
  theme,
  onFallback,
}: {
  provider: BasemapProvider;
  theme: MapTheme;
  onFallback: () => void;
}) {
  const map = useMap();
  const layerRef = useRef<L.MaplibreGL | null>(null);

  useEffect(() => {
    if (provider !== 'openfreemap') return;

    let isActive = true;
    let hasFailed = false;
    let layer: L.MaplibreGL | null = null;

    try {
      layer = maplibreGL({
        style: OPENFREEMAP_STYLE,
        attributionControl: false,
      });
      layer.addTo(map);
      layerRef.current = layer;

      const maplibreMap = layer.getMaplibreMap();
      const handleError = (event: unknown) => {
        if (!isActive || hasFailed) return;
        hasFailed = true;
        console.warn('[map] OpenFreeMap failed; using the raster fallback', event);
        onFallback();
      };

      maplibreMap.on('error', handleError);

      return () => {
        isActive = false;
        maplibreMap.off('error', handleError);
        if (layer && map.hasLayer(layer)) map.removeLayer(layer);
        if (layerRef.current === layer) layerRef.current = null;
      };
    } catch (error) {
      console.warn('[map] OpenFreeMap is unavailable; using the raster fallback', error);
      onFallback();
    }
  }, [map, onFallback, provider]);

  useEffect(() => {
    if (provider !== 'openfreemap' || !layerRef.current) return;

    const maplibreMap = layerRef.current.getMaplibreMap();
    const applyMapStyle = () => {
      if (maplibreMap.getLayer('water')) {
        maplibreMap.setPaintProperty(
          'water',
          'fill-color',
          theme === 'light' ? LIGHT_WATER_COLOR : DARK_THEME_SOURCE_WATER_COLOR
        );
      }

      maplibreMap.getStyle().layers?.forEach((layer) => {
        if (layer.type !== 'symbol' || !layer.layout?.['text-field']) return;

        const configuredFont = layer.layout['text-font'];
        if (JSON.stringify(configuredFont).includes('Italic')) {
          maplibreMap.setLayoutProperty(layer.id, 'text-font', MAP_LABEL_FONT);
        }
      });
    };

    if (maplibreMap.isStyleLoaded()) {
      applyMapStyle();
      return;
    }

    maplibreMap.on('load', applyMapStyle);
    return () => { maplibreMap.off('load', applyMapStyle); };
  }, [provider, theme]);

  if (provider === 'osm') {
    return (
      <TileLayer
        maxZoom={19}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    );
  }

  return null;
}

function MapController({
  onMapClick,
  onZoomChange,
}: {
  onMapClick: () => void;
  onZoomChange: (zoom: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const handleZoomEnd = () => { onZoomChange(map.getZoom()); };

    onZoomChange(map.getZoom());
    map.on('click', onMapClick);
    map.on('zoomend', handleZoomEnd);
    return () => {
      map.off('click', onMapClick);
      map.off('zoomend', handleZoomEnd);
    };
  }, [map, onMapClick, onZoomChange]);
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
  const [basemapProvider, setBasemapProvider] = useState<BasemapProvider>('openfreemap');
  const [mapTheme, setMapTheme] = useState<MapTheme>(getInitialMapTheme);
  const [currentZoom, setCurrentZoom] = useState(INITIAL_ZOOM);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setSelectedCityKey(null);
  }, [clusters]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAP_THEME_STORAGE_KEY, mapTheme);
    } catch {
      // The map still works when storage is unavailable.
    }
  }, [mapTheme]);

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

  const handleBasemapFallback = useCallback(() => {
    setBasemapProvider('osm');
  }, []);

  const toggleMapTheme = () => {
    setMapTheme((theme) => theme === 'light' ? 'dark' : 'light');
  };

  const zoomIn = () => { mapRef.current?.zoomIn(); };
  const zoomOut = () => {
    if ((mapRef.current?.getZoom() ?? INITIAL_ZOOM) > INITIAL_ZOOM) {
      mapRef.current?.zoomOut();
    }
  };
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
    <div
      ref={containerRef}
      className={`absolute inset-0 select-none basemap-${basemapProvider} map-theme-${mapTheme}`}
    >
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
        .map-theme-light.basemap-openfreemap .leaflet-gl-layer,
        .map-theme-light.basemap-osm .leaflet-tile-pane {
          filter: grayscale(1);
        }
        .map-theme-dark.basemap-openfreemap .leaflet-gl-layer,
        .map-theme-dark.basemap-osm .leaflet-tile-pane {
          filter: grayscale(1) invert(1);
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
          minZoom={INITIAL_ZOOM}
          maxZoom={18}
          style={{ height: '100%', width: '100%', background: '#f8fafc' }}
          zoomControl={false}
          attributionControl={false}
          ref={(map) => { mapRef.current = map; }}
        >
          <ApiFreeBasemap
            provider={basemapProvider}
            theme={mapTheme}
            onFallback={handleBasemapFallback}
          />
          
          <MapController
            onMapClick={handleBackdropClick}
            onZoomChange={setCurrentZoom}
          />

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

        <div className="absolute bottom-1 left-1 z-[1000] rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-slate-600 shadow-sm backdrop-blur-sm">
          {basemapProvider === 'openfreemap' ? (
            <>
              <a className="hover:underline" href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>
              {' · © '}
              <a className="hover:underline" href="https://www.openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a>
              {' · © '}
              <a className="hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
            </>
          ) : (
            <>
              {'© '}
              <a className="hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
            </>
          )}
        </div>

        {/* Custom Zoom Controls */}
        <div className="absolute bottom-6 right-6 z-[1000] flex flex-col items-center space-y-2">
          <button
            onClick={(e) => { e.stopPropagation(); toggleMapTheme(); }}
            className={`mb-2 flex h-10 w-10 items-center justify-center rounded-lg border shadow-lg transition-colors active:scale-95 ${
              mapTheme === 'dark'
                ? 'border-gray-700 bg-gray-900 hover:bg-gray-800'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
            title={mapTheme === 'dark' ? 'Use light map' : 'Use dark map'}
            aria-label={mapTheme === 'dark' ? 'Use light map' : 'Use dark map'}
          >
            {mapTheme === 'dark' ? (
              <Sun className="h-5 w-5 text-white" />
            ) : (
              <Moon className="h-5 w-5 text-gray-700" />
            )}
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); zoomIn(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors active:scale-95"
            title="Zoom In"
          >
            <ZoomIn className="w-5 h-5 text-gray-700" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); zoomOut(); }}
            disabled={currentZoom <= INITIAL_ZOOM}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:active:scale-100"
            title={currentZoom <= INITIAL_ZOOM ? 'Minimum zoom reached' : 'Zoom Out'}
            aria-label={currentZoom <= INITIAL_ZOOM ? 'Minimum zoom reached' : 'Zoom Out'}
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
                <Earth className="h-4 w-4 animate-spin" aria-hidden="true" />
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
