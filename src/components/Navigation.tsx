import { User, MapPin, Library, Shield, Plus, Search } from 'lucide-react';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string, id?: string) => void;
  searchInputValue: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (query: string) => void;
  isSearching: boolean;
}

export default function Navigation({
  currentPage,
  onNavigate,
  onSearchSubmit,
}: NavigationProps) {
  const navItems = [
    { id: 'dashboard', label: 'Network', icon: MapPin },
    { id: 'collections', label: 'Collections', icon: Library },
    { id: 'admin', label: 'Dashboard', icon: Shield },
  ];

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 justify-between">
          <div className="flex items-center gap-6 flex-shrink-0">
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex items-center space-x-2 text-xl font-semibold"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-gray-900" />
              </div>
              <span className="hidden lg:inline text-gray-900">
                Flemish Network
              </span>
            </button>

            <div className="hidden md:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === item.id
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {currentPage !== 'dashboard' && (
              <button
                onClick={() => onSearchSubmit('')}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
                title="Search the network"
              >
                <Search className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => onNavigate('add-contact')}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
                currentPage === 'add-contact'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
              }`}
              title="Add new contact"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
              <User className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      <div className="md:hidden border-t border-gray-200">
        <div className="flex justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-lg ${
                  currentPage === item.id
                    ? 'text-yellow-600'
                    : 'text-gray-600'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => onNavigate('add-contact')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-lg ${
              currentPage === 'add-contact' ? 'text-yellow-600' : 'text-gray-600'
            }`}
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs">Add</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
