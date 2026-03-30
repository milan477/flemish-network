import { useState } from 'react';
import { Briefcase, MapPin, Network, Tag, X } from 'lucide-react';
import { displayName, type FilterPreset, type Person } from '../lib/supabase';
import { ProfileAvatar } from './ProfileAvatar';

type ConnectedPerson = Pick<
  Person,
  | 'id'
  | 'name'
  | 'title'
  | 'first_name'
  | 'last_name'
  | 'current_position'
  | 'occupation'
  | 'profile_photo_url'
  | 'email'
  | 'location_id'
  | 'locations'
>;

export interface GraphConnection {
  person: ConnectedPerson;
  relationshipTypes: string[];
  connectionIds: string[];
  strength: number;
}

interface ConnectionGraphModalProps {
  person: Person;
  connections: GraphConnection[];
  onClose: () => void;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

const TYPE_STYLES: Record<string, string> = {
  colleague: 'bg-blue-50 text-blue-700 border-blue-100',
  alumni: 'bg-amber-50 text-amber-700 border-amber-100',
  local_peer: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

function formatRelationshipType(type: string): string {
  if (type === 'local_peer') return 'Local Peer';
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRelationshipClasses(type: string): string {
  return TYPE_STYLES[type] || 'bg-gray-50 text-gray-700 border-gray-200';
}

function getNodePosition(index: number, count: number) {
  if (count === 1) {
    return { x: 50, y: 18 };
  }

  const startAngle = -90;
  const step = 360 / count;
  const radius = count <= 4 ? 35 : count <= 8 ? 39 : 42;
  const angle = ((startAngle + step * index) * Math.PI) / 180;

  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  };
}

function describeEdgePath(x: number, y: number) {
  const dx = x - 50;
  const dy = y - 50;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const curve = Math.min(7, Math.max(3, length * 0.08));
  const controlX = 50 + dx * 0.5 - (dy / length) * curve;
  const controlY = 50 + dy * 0.5 + (dx / length) * curve;

  return `M 50 50 Q ${controlX} ${controlY} ${x} ${y}`;
}

function getTooltipPlacement(x: number, y: number) {
  const horizontal =
    x < 28 ? 'translate-x-0' : x > 72 ? '-translate-x-full' : '-translate-x-1/2';
  const vertical = y < 28 ? 'translate-y-6' : '-translate-y-[calc(100%+1rem)]';

  return {
    className: `${horizontal} ${vertical}`,
    style: { left: `${x}%`, top: `${y}%` },
  };
}

export default function ConnectionGraphModal({
  person,
  connections,
  onClose,
  onNavigate,
}: ConnectionGraphModalProps) {
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  const typeCounts = connections.reduce<Record<string, number>>((counts, connection) => {
    connection.relationshipTypes.forEach((type) => {
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, {});

  const layouts = connections.map((connection, index) => ({
    connection,
    ...getNodePosition(index, connections.length),
  }));

  const activeLayout = activeConnectionId
    ? layouts.find((layout) => layout.connection.person.id === activeConnectionId) || null
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-3 sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_32px_100px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 sm:px-7">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Connection Graph</h2>
            <p className="mt-1 text-sm text-slate-500">
              Hover a node to preview it. Click an avatar to open that profile.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {connections.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50 text-center">
              <Network className="mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No direct connections yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Run the Connections agent from Admin to generate graph edges.
              </p>
            </div>
          ) : (
            <>
              <div
                className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-slate-50 shadow-inner"
                style={{ minHeight: '520px', height: '620px' }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at top, rgba(96,165,250,0.12), transparent 28%), radial-gradient(circle at bottom, rgba(251,191,36,0.12), transparent 30%), radial-gradient(rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%)',
                    backgroundSize: 'auto, auto, 18px 18px, auto',
                    backgroundPosition: 'center top, center bottom, 0 0, center',
                  }}
                />

                <div className="absolute left-4 top-4 z-30 flex max-w-[70%] flex-wrap gap-2">
                  <span className="rounded-full bg-white/92 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
                    {connections.length} direct {connections.length === 1 ? 'connection' : 'connections'}
                  </span>
                  {Object.entries(typeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <span
                        key={type}
                        className={`rounded-full border px-3 py-1 text-xs font-medium backdrop-blur ${getRelationshipClasses(type)}`}
                      >
                        {formatRelationshipType(type)} {count}
                      </span>
                    ))}
                </div>

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 z-10 h-full w-full"
                  aria-hidden="true"
                >
                  {layouts.map(({ connection, x, y }) => {
                    const isActive = activeConnectionId === connection.person.id;
                    return (
                      <path
                        key={connection.person.id}
                        d={describeEdgePath(x, y)}
                        fill="none"
                        stroke={isActive ? 'rgba(245, 158, 11, 0.95)' : 'rgba(148, 163, 184, 0.5)'}
                        strokeWidth={isActive ? '1' : '0.65'}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </svg>

                <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                  <div className="rounded-full bg-white p-2 shadow-lg ring-2 ring-amber-200">
                    <ProfileAvatar person={person} size="lg" />
                  </div>
                  <div className="mt-3 rounded-full bg-white px-4 py-2 text-center shadow-sm ring-1 ring-slate-200">
                    <div className="text-sm font-semibold text-slate-900">{displayName(person)}</div>
                    <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-700">
                      Focus Person
                    </div>
                  </div>
                </div>

                {layouts.map(({ connection, x, y }) => {
                  const isActive = activeConnectionId === connection.person.id;

                  return (
                    <button
                      key={connection.person.id}
                      type="button"
                      onMouseEnter={() => setActiveConnectionId(connection.person.id)}
                      onMouseLeave={() => setActiveConnectionId((current) => (
                        current === connection.person.id ? null : current
                      ))}
                      onFocus={() => setActiveConnectionId(connection.person.id)}
                      onBlur={() => setActiveConnectionId((current) => (
                        current === connection.person.id ? null : current
                      ))}
                      onClick={() => {
                        onClose();
                        onNavigate('person', connection.person.id);
                      }}
                      className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1.5 transition-all duration-200 ${
                        isActive
                          ? 'scale-110 shadow-xl ring-2 ring-amber-300'
                          : 'shadow-md ring-1 ring-slate-200 hover:scale-105 hover:shadow-lg'
                      }`}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      aria-label={`Open profile for ${displayName(connection.person)}`}
                    >
                      <ProfileAvatar person={connection.person} size="sm" />
                    </button>
                  );
                })}

                {activeLayout && (
                  <div
                    className={`pointer-events-none absolute z-30 w-[240px] rounded-3xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 ${getTooltipPlacement(activeLayout.x, activeLayout.y).className}`}
                    style={getTooltipPlacement(activeLayout.x, activeLayout.y).style}
                  >
                    <div className="flex items-start gap-3">
                      <ProfileAvatar person={activeLayout.connection.person} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">
                          {displayName(activeLayout.connection.person)}
                        </div>
                        {activeLayout.connection.person.current_position && (
                          <div className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
                            <Briefcase className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span className="line-clamp-2">{activeLayout.connection.person.current_position}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeLayout.connection.relationshipTypes.map((type) => (
                        <span
                          key={`${activeLayout.connection.person.id}-${type}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${getRelationshipClasses(type)}`}
                        >
                          <Tag className="h-3 w-3" />
                          {formatRelationshipType(type)}
                        </span>
                      ))}
                    </div>

                    {(activeLayout.connection.person.locations?.city || activeLayout.connection.person.occupation) && (
                      <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                        {activeLayout.connection.person.locations?.city && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>
                              {activeLayout.connection.person.locations.city}
                              {activeLayout.connection.person.locations.state
                                ? `, ${activeLayout.connection.person.locations.state}`
                                : ''}
                            </span>
                          </div>
                        )}
                        {activeLayout.connection.person.occupation && (
                          <div className="flex items-center gap-1.5">
                            <Briefcase className="h-3.5 w-3.5" />
                            <span>{activeLayout.connection.person.occupation}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                      Strength {activeLayout.connection.strength}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-3 md:hidden">
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  Connections
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {connections.map((connection) => (
                    <button
                      key={connection.person.id}
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigate('person', connection.person.id);
                      }}
                      className="min-w-[180px] rounded-2xl border border-white bg-white p-3 text-left shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <ProfileAvatar person={connection.person} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {displayName(connection.person)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {connection.relationshipTypes.map((type) => (
                              <span
                                key={`${connection.person.id}-${type}`}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getRelationshipClasses(type)}`}
                              >
                                {formatRelationshipType(type)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
