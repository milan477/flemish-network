import { X, MapPin, Users, Building2, ExternalLink } from 'lucide-react';
import { displayName, personInitials } from '../lib/supabase';
import type { MapCluster } from '../lib/supabase';

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
      className="w-80 bg-white rounded-xl overflow-hidden pointer-events-auto flex flex-col max-h-[70vh]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-gradient-to-r from-yellow-50 to-amber-50 px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <MapPin className="w-3.5 h-3.5 text-yellow-600" />
            <h3 className="font-semibold text-gray-900 text-sm">
              {cluster.city}, {cluster.state}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/60 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">{totalCount} contacts</p>
      </div>

      <div className="overflow-y-auto custom-scrollbar">
        {cluster.people.length > 0 && (
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center space-x-1 mb-1 px-1">
              <Users className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                People ({cluster.people.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {cluster.people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onNavigate('person', person.id)}
                  className="w-full flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-blue-700">
                      {personInitials(person)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate group-hover:text-yellow-700 transition-colors leading-tight">
                      {displayName(person)}
                    </p>
                    {person.current_position && (
                      <p className="text-[10px] text-gray-500 truncate leading-tight">{person.current_position}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {cluster.organizations.length > 0 && (
          <div className="px-2 pt-1 pb-1 border-t border-gray-50">
            <div className="flex items-center space-x-1 mb-1 px-1 mt-1">
              <Building2 className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                Orgs ({cluster.organizations.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {cluster.organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => onNavigate('organization', org.id)}
                  className="w-full flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                >
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate group-hover:text-yellow-700 transition-colors leading-tight">
                      {org.name}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate leading-tight">{org.type}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex-shrink-0">
        <button
          onClick={() => onViewInDirectory(cluster.city, cluster.state, allPersonIds)}
          className="w-full flex items-center justify-center space-x-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold text-xs rounded-lg transition-colors shadow-sm"
        >
          <span>Open in List View</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
