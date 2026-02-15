import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase, type Sector } from '../lib/supabase';
import AddContactPanel from '../components/admin/AddContactPanel';

interface AddContactProps {
  onNavigate: (page: string) => void;
}

export default function AddContact({ onNavigate }: AddContactProps) {
  const [sectors, setSectors] = useState<Sector[]>([]);

  useEffect(() => {
    supabase.from('sectors').select('*').then(({ data }) => {
      setSectors((data || []) as Sector[]);
    });
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => onNavigate('dashboard')}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <AddContactPanel sectors={sectors} onContactAdded={() => {}} />
    </div>
  );
}
