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
      className="w-80 bg-white rounded-xl overflow-hidden pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-gradient-to-r from-yellow-50 to-amber-50 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <MapPin className="w-4 h-4 text-yellow-600" />
            <h3 className="font-semibold text-gray-900">
              {cluster.city}, {cluster.state}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/60 rounded-md transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1">{totalCount} contacts in this area</p>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {cluster.people.length > 0 && (
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center space-x-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                People ({cluster.people.length})
              </span>
            </div>
            <div className="space-y-1">
              {cluster.people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onNavigate('person', person.id)}
                  className="w-full flex items-center space-x-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-blue-700">
                      {personInitials(person)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-yellow-700 transition-colors">
                      {displayName(person)}
                    </p>
                    {person.current_position && (
                      <p className="text-xs text-gray-500 truncate">{person.current_position}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {cluster.organizations.length > 0 && (
          <div className="px-4 pt-2 pb-2 border-t border-gray-100">
            <div className="flex items-center space-x-1.5 mb-2">
              <Building2 className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Organizations ({cluster.organizations.length})
              </span>
            </div>
            <div className="space-y-1">
              {cluster.organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => onNavigate('organization', org.id)}
                  className="w-full flex items-center space-x-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-yellow-700 transition-colors">
                      {org.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{org.type}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
        <button
          onClick={() => onViewInDirectory(cluster.city, cluster.state, allPersonIds)}
          className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium text-sm rounded-lg transition-colors"
        >
          <span>View as List</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
