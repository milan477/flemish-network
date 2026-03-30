import { X, MapPin, Building2, ExternalLink } from 'lucide-react';
import { displayName } from '../lib/supabase';
import type { MapCluster } from '../lib/supabase';
import { ProfileAvatar } from './ProfileAvatar';

interface ClusterPopoverProps {
  cluster: MapCluster;
  onClose: () => void;
  onViewInDirectory: (city: string, state: string, personIds: string[]) => void;
  onNavigate: (page: string, id?: string) => void;
}

export default function ClusterPopover({
  cluster,
  onClose,
  onViewInDirectory,
  onNavigate,
}: ClusterPopoverProps) {
  const totalCount = cluster.people.length + cluster.organizations.length;
  const allPersonIds = cluster.people.map((p) => p.id);

  return (
    <div
      className="w-[280px] bg-white rounded-xl overflow-hidden pointer-events-auto flex flex-col max-h-[50vh] shadow-2xl border border-gray-100"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="bg-amber-50 px-2 py-1.5 border-b border-amber-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-x-1.5">
            <MapPin className="w-3.5 h-3.5 text-amber-600" />
            <h3 className="font-bold text-gray-900 text-[13px] leading-tight">
              {cluster.city}, {cluster.state}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-amber-100 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
        <div className="text-[9px] font-black text-amber-700 uppercase tracking-widest mt-0.5 opacity-80">
          {totalCount} TOTAL CONTACTS
        </div>
      </div>

      <div className="overflow-y-auto custom-scrollbar">
        {cluster.people.length > 0 && (
          <div className="pb-0.5">
            <div className="px-2 py-0.5 bg-gray-50/50 border-b border-gray-100/30">
              <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                PEOPLE ({cluster.people.length})
              </span>
            </div>
            <div className="px-0.5">
              {cluster.people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onNavigate('person', person.id)}
                  className="w-full flex items-center gap-x-2.5 px-2 py-0 hover:bg-yellow-50/50 rounded-lg transition-colors text-left group"
                >
                  <ProfileAvatar person={person} size="sm" variant="dark" className="shadow-sm" />

                  {/* UPDATED TEXT BLOCK */}
                  <div className="flex-1 min-w-0 min-h-0">
                    <p className="text-[12px] font-bold text-gray-900 truncate leading-[1.1]">
                      {displayName(person)}
                    </p>
                    {person.current_position && (
                      <p className="text-[11px] text-gray-500 truncate font-medium leading-[1.1]">
                        {person.current_position}
                      </p>
                    )}
                  </div>
                  {/* <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-[12px] font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors leading-[1.1]">
                      {displayName(person)}
                    </p>
                    {person.current_position && (
                      <p className="text-[11px] text-gray-500 truncate font-medium leading-[1.1] -mt-[1px]">
                        {person.current_position}
                      </p>
                    )}
                  </div> */}
                </button>
              ))}
            </div>
          </div>
        )}

        {cluster.organizations.length > 0 && (
          <div className="border-t border-gray-100 pb-0.5">
            <div className="px-2 py-0.5 bg-gray-50/50 border-b border-gray-100/30">
              <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                ORGANIZATIONS ({cluster.organizations.length})
              </span>
            </div>
            <div className="px-0.5 pt-0.5">
              {cluster.organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => onNavigate('organization', org.id)}
                  className="w-full flex items-center gap-x-2.5 px-2 py-0 hover:bg-yellow-50/50 rounded-lg transition-colors text-left group"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Building2 className="w-4 h-4 text-white" />
                  </div>

                  {/* UPDATED TEXT BLOCK */}
                  <div className="flex-1 min-w-0 min-h-0">
                    <p className="text-[12px] font-bold text-gray-900 truncate leading-tight">
                      {displayName(org)}
                    </p>
                    {org.type && (
                      <p className="text-[11px] text-gray-500 truncate font-medium leading-tight mt-[2px]">
                        {org.type}
                      </p>
                    )}
                  </div>
                  {/* <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-[12px] font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors leading-[1.1]">
                      {org.name}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate font-medium leading-[1.1] -mt-[1px]">
                      {org.type}
                    </p>
                  </div> */}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-2 py-2 border-t border-gray-100 bg-white flex-shrink-0">
        <button
          onClick={() =>
            onViewInDirectory(cluster.city, cluster.state, allPersonIds)
          }
          className="w-full flex items-center justify-center gap-x-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold text-[11px] rounded-lg transition-all shadow-md active:scale-[0.98]"
        >
          <span>Open in List View</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}