import { useEffect, useState } from 'react';
import { MapPin, Building2, ArrowLeft, Users, ExternalLink } from 'lucide-react';
import { supabase, displayName, personInitials, type Organization, type Person } from '../lib/supabase';

interface OrganizationProfileProps {
  organizationId: string;
  onNavigate: (page: string, id?: string) => void;
}

export default function OrganizationProfile({ organizationId, onNavigate }: OrganizationProfileProps) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrganization();
    loadPeople();
  }, [organizationId]);

  const loadOrganization = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle();

    setOrganization(data);
    setLoading(false);
  };

  const loadPeople = async () => {
    const { data } = await supabase
      .from('people')
      .select('*')
      .eq('organization_id', organizationId)
      .limit(6);

    setPeople(data || []);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600"></div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Organization not found</h2>
        <button
          onClick={() => onNavigate('directory')}
          className="text-yellow-600 hover:text-yellow-700 font-medium"
        >
          Return to directory
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => onNavigate('directory')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to directory</span>
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start space-x-6 mb-8">
            <div className="w-24 h-24 rounded-xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-12 h-12 text-green-700" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-semibold text-gray-900 mb-2">{organization.name}</h1>
              <p className="text-lg text-gray-600 mb-2">{organization.type}</p>
              {organization.location_city && (
                <div className="flex items-center space-x-2 text-gray-600 mb-4">
                  <MapPin className="w-5 h-5" />
                  <span>{organization.location_city}, {organization.location_state}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
                  Biotechnology
                </span>
                <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                  Research
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-lg transition-colors flex items-center space-x-2">
                  <ExternalLink className="w-4 h-4" />
                  <span>Visit Website</span>
                </button>
                <button className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition-colors">
                  Save to List
                </button>
              </div>
            </div>
          </div>

          {organization.description && (
            <div className="mb-8 pb-8 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">About</h2>
              <p className="text-gray-700 leading-relaxed">{organization.description}</p>
            </div>
          )}

          {organization.flemish_link && (
            <div className="mb-8 pb-8 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Flemish Connection</h2>
              <p className="text-gray-700">{organization.flemish_link}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Key Contacts</h2>
              </div>
              {people.length > 6 && (
                <button className="text-yellow-600 hover:text-yellow-700 font-medium text-sm">
                  See all {people.length} contacts
                </button>
              )}
            </div>

            {people.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {people.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => onNavigate('person', person.id)}
                    className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors text-left border border-gray-200"
                  >
                    <div className="flex items-start space-x-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-semibold text-blue-700">
                          {personInitials(person)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 mb-1">{displayName(person)}</h3>
                        {person.current_position && (
                          <p className="text-sm text-gray-600 line-clamp-2">{person.current_position}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-xl">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No contacts found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
