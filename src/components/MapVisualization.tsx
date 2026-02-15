import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapPin, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { MapCluster } from '../lib/supabase';
import ClusterPopover from './ClusterPopover';
import { getStatePaths, getAlaskaPath, getHawaiiPaths, projectToSvg, SVG_WIDTH, SVG_HEIGHT } from '../lib/usMapData';

interface MapVisualizationProps {
  clusters: MapCluster[];
  loading: boolean;
  onViewInDirectory: (city: string, state: string, personIds: string[]) => void;
  onNavigate: (page: string, id?: string) => void;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export default function MapVisualization({ clusters, loading, onViewInDirectory, onNavigate }: MapVisualizationProps) {
  const [selectedCluster, setSelectedCluster] = useState<MapCluster | null>(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const statePaths = useMemo(() => getStatePaths(), []);
  const alaskaPath = useMemo(() => getAlaskaPath(), []);
  const hawaiiPaths = useMemo(() => getHawaiiPaths(), []);

  useEffect(() => {
    setSelectedCluster(null);
  }, [clusters]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const newZoom = clamp(zoom + delta * zoom, MIN_ZOOM, MAX_ZOOM);
      const ratio = newZoom / zoom;

      setPan({
        x: mouseX - (mouseX - pan.x) * ratio,
        y: mouseY - (mouseY - pan.y) * ratio,
      });
      setZoom(newZoom);
    },
    [zoom, pan]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    const onUp = () => setIsPanning(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const zoomIn = () => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newZoom = clamp(zoom * 1.3, MIN_ZOOM, MAX_ZOOM);
    const ratio = newZoom / zoom;
    setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
    setZoom(newZoom);
  };

  const zoomOut = () => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newZoom = clamp(zoom / 1.3, MIN_ZOOM, MAX_ZOOM);
    const ratio = newZoom / zoom;
    setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
    setZoom(newZoom);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleClusterClick = (cluster: MapCluster, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPopoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setSelectedCluster(cluster);
  };

  const handleBackdropClick = () => {
    setSelectedCluster(null);
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className="w-full h-full bg-white relative overflow-hidden">
        <svg
          className="w-full h-full"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="clusterShadow">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.15" />
            </filter>
            <radialGradient id="clusterGrad" cx="40%" cy="40%">
              <stop offset="0%" stopColor="#FDE047" />
              <stop offset="100%" stopColor="#EAB308" />
            </radialGradient>
            <radialGradient id="clusterGradSelected" cx="40%" cy="40%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#B45309" />
            </radialGradient>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <g>
              {statePaths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="#e5e7eb"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              ))}
            </g>

            <g opacity="0.5">
              <path
                d={alaskaPath}
                fill="#e5e7eb"
                stroke="#ffffff"
                strokeWidth="1"
                strokeLinejoin="round"
              />
              <rect x="10" y="470" width="150" height="110" fill="none" stroke="#d1d5db" strokeWidth="0.5" rx="2" />
            </g>

            <g opacity="0.5">
              {hawaiiPaths.map((d, i) => (
                <path
                  key={`hi-${i}`}
                  d={d}
                  fill="#e5e7eb"
                  stroke="#ffffff"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              ))}
              <rect x="210" y="500" width="100" height="70" fill="none" stroke="#d1d5db" strokeWidth="0.5" rx="2" />
            </g>

            {loading && (
              <text x={SVG_WIDTH / 2} y={SVG_HEIGHT / 2} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '16px' }}>
                Loading...
              </text>
            )}

            {!loading && clusters.length === 0 && (
              <text x={SVG_WIDTH / 2} y={SVG_HEIGHT / 2} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '16px' }}>
                No results match your filters
              </text>
            )}

            {clusters.map((cluster) => {
              const { x, y } = projectToSvg(cluster.lat, cluster.lng);
              const count = cluster.people.length + cluster.organizations.length;
              const radius = clamp(Math.sqrt(count) * 8, 10, 40);
              const isSelected = selectedCluster?.city === cluster.city && selectedCluster?.state === cluster.state;
              const invZoom = 1 / zoom;

              return (
                <g
                  key={`${cluster.city}-${cluster.state}`}
                  transform={`translate(${x},${y}) scale(${invZoom})`}
                  className="cursor-pointer"
                  style={{ pointerEvents: 'all' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClusterClick(cluster, e);
                  }}
                >
                  <circle cx={0} cy={0} r={radius * 2} fill={isSelected ? '#D97706' : '#FACC15'} opacity="0.08">
                    <animate
                      attributeName="r"
                      values={`${radius * 1.6};${radius * 2.2};${radius * 1.6}`}
                      dur="4s"
                      repeatCount="indefinite"
                    />
                  </circle>

                  <circle
                    cx={0}
                    cy={0}
                    r={radius * 1.2}
                    fill={isSelected ? '#D97706' : '#FDE047'}
                    opacity="0.2"
                  />

                  <circle
                    cx={0}
                    cy={0}
                    r={radius}
                    fill={`url(#${isSelected ? 'clusterGradSelected' : 'clusterGrad'})`}
                    className="transition-all duration-200"
                  />

                  <text
                    x={0}
                    y={count > 9 ? 4 : 5}
                    textAnchor="middle"
                    fill="#fff"
                    fontWeight="700"
                    style={{ fontSize: radius > 18 ? '14px' : '11px', pointerEvents: 'none' }}
                  >
                    {count}
                  </text>

                  <rect
                    x={-cluster.city.length * 3.2 - 6}
                    y={radius + 6}
                    width={cluster.city.length * 6.4 + 12}
                    height={18}
                    rx={4}
                    fill="white"
                    opacity="0.9"
                    filter="url(#clusterShadow)"
                  />
                  <text
                    x={0}
                    y={radius + 19}
                    textAnchor="middle"
                    fill="#1F2937"
                    fontWeight="600"
                    style={{ fontSize: '11px', pointerEvents: 'none' }}
                  >
                    {cluster.city}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-center space-x-2 mb-1">
              <MapPin className="w-4 h-4 text-yellow-600" />
              <span className="font-semibold text-sm text-gray-900">Network Map</span>
            </div>
            <p className="text-xs text-gray-500">Scroll to zoom, drag to pan</p>
          </div>
        </div>

        <div className="absolute bottom-6 right-6 flex flex-col items-center space-y-1">
          <button
            onClick={(e) => { e.stopPropagation(); zoomIn(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-gray-700" />
          </button>

          <div className="w-10 h-8 bg-white/90 rounded-md shadow-sm border border-gray-200 flex items-center justify-center">
            <span className="text-[10px] font-medium text-gray-600">{zoomPercent}%</span>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); zoomOut(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-gray-700" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); resetView(); }}
            className="w-10 h-10 bg-white hover:bg-gray-50 rounded-lg shadow-lg border border-gray-200 flex items-center justify-center transition-colors mt-2"
          >
            <Maximize2 className="w-4 h-4 text-gray-700" />
          </button>
        </div>
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
