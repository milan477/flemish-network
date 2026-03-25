import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  Loader2,
  CheckCheck,
  Search,
  Users,
} from 'lucide-react';
import { supabase, parseTitleFromName, type Sector, type Person } from '../../lib/supabase';
import { searchContacts } from '../../lib/aiService';
import ContactCard, {
  ContactCardEdit,
  type DiscoveredContact,
} from './ContactCard';
import DuplicateCompare from './DuplicateCompare';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AdminChatbotProps {
  sectors: Sector[];
  onContactAdded: () => void;
}

async function addContactToDb(
  contact: DiscoveredContact,
  allSectors: Sector[]
): Promise<boolean> {
  const hasEmail = !!(contact.email && contact.email.includes('@'));
  const parsed = parseTitleFromName(contact.name || '');
  const { data: person, error } = await supabase
    .from('people')
    .insert({
      name: contact.name,
      title: parsed.title || null,
      first_name: parsed.firstName || null,
      last_name: parsed.lastName || null,
      current_position: contact.current_position || null,
      occupation: contact.occupation || null,
      location_id: contact.location_id || null,
      bio: contact.bio || null,
      flemish_connection: contact.flemish_connection || null,
      email: contact.email || null,
      email_verified: hasEmail ? false : null,
      linkedin_url: contact.linkedin_url || null,
      website_url: contact.website_url || null,
      data_source: 'ai_agent',
    })
    .select('id')
    .maybeSingle();

  if (error || !person) return false;

  if (contact.sectors && contact.sectors.length > 0) {
    const matchedSectors = allSectors.filter((s) =>
      contact.sectors.includes(s.name)
    );
    if (matchedSectors.length > 0) {
      await supabase.from('person_sectors').insert(
        matchedSectors.map((s) => ({
          person_id: person.id,
          sector_id: s.id,
        }))
      );
    }
  }
  return true;
}

async function updateExistingContact(
  existingId: string,
  contact: DiscoveredContact,
  selectedFields: string[],
  allSectors: Sector[]
): Promise<boolean> {
  const updates: Record<string, unknown> = {};
  const contactObj = contact as unknown as Record<string, unknown>;

  for (const field of selectedFields) {
    const val = contactObj[field];
    if (val !== undefined && val !== null && val !== '') {
      updates[field] = val;
    }
  }

  if (selectedFields.includes('email') && updates.email) {
    updates.email_verified = false;
  }

  if (Object.keys(updates).length === 0) return true;

  const { error } = await supabase
    .from('people')
    .update(updates)
    .eq('id', existingId);

  if (error) return false;

  if (contact.sectors && contact.sectors.length > 0) {
    const matchedSectors = allSectors.filter((s) =>
      contact.sectors.includes(s.name)
    );
    if (matchedSectors.length > 0) {
      const { data: existing } = await supabase
        .from('person_sectors')
        .select('sector_id')
        .eq('person_id', existingId);
      const existingIds = new Set(
        (existing || []).map((r: { sector_id: string }) => r.sector_id)
      );
      const toInsert = matchedSectors.filter((s) => !existingIds.has(s.id));
      if (toInsert.length > 0) {
        await supabase.from('person_sectors').insert(
          toInsert.map((s) => ({
            person_id: existingId,
            sector_id: s.id,
          }))
        );
      }
    }
  }

  return true;
}

export default function AdminChatbot({
  sectors,
  onContactAdded,
}: AdminChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'I can search the web and find contacts for you. Try:\n\n- A name: "Jan De Vries"\n- A group: "Flemish AI researchers in Boston"\n- A description: "Belgian students at Stanford"',
    },
  ]);
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [discoveredContacts, setDiscoveredContacts] = useState<
    DiscoveredContact[]
  >([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [compareContact, setCompareContact] =
    useState<DiscoveredContact | null>(null);
  const [existingPerson, setExistingPerson] = useState<Person | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, processing]);

  const addBot = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'assistant', content },
    ]);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || processing) return;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: trimmed },
    ]);
    setInput('');
    setProcessing(true);
    setCompareContact(null);
    setExistingPerson(null);

    try {
      const result = await searchContacts(trimmed);

      if (result.contacts.length === 0) {
        addBot(
          result.message ||
            "I couldn't find any contacts matching that query. Try a more specific name or description."
        );
        setDiscoveredContacts([]);
      } else {
        const contacts: DiscoveredContact[] = result.contacts.map((c) => ({
          ...c,
          id: crypto.randomUUID(),
        }));
        const dupeCount = contacts.filter((c) => c.is_duplicate).length;
        let msg = result.message;
        if (dupeCount > 0) {
          msg += `\n\n${dupeCount} potential duplicate${dupeCount > 1 ? 's' : ''} detected -- use Compare to review.`;
        }
        addBot(msg);
        setDiscoveredContacts(contacts);
      }
    } catch {
      addBot(
        'I had trouble searching for contacts. Please try again with a different query.'
      );
      setDiscoveredContacts([]);
    }

    setProcessing(false);
  };

  const handleAdd = async (contact: DiscoveredContact) => {
    setAddingId(contact.id);
    const ok = await addContactToDb(contact, sectors);
    setAddingId(null);
    if (ok) {
      setAddedIds((prev) => new Set([...prev, contact.id]));
      onContactAdded();
    }
  };

  const handleAddAll = async () => {
    const toAdd = discoveredContacts.filter(
      (c) => !addedIds.has(c.id) && !c.is_duplicate
    );
    for (const c of toAdd) {
      setAddingId(c.id);
      const ok = await addContactToDb(c, sectors);
      if (ok) setAddedIds((prev) => new Set([...prev, c.id]));
      setAddingId(null);
    }
    onContactAdded();
  };

  const handleCompare = async (contact: DiscoveredContact) => {
    if (!contact.existing_person_id) return;
    setLoadingCompare(true);
    const { data } = await supabase
      .from('people').select('*, locations(*)')
      .eq('id', contact.existing_person_id)
      .maybeSingle();
    setLoadingCompare(false);
    if (data) {
      setExistingPerson(data as Person);
      setCompareContact(contact);
    }
  };

  const handleUpdate = async (selectedFields: string[]) => {
    if (!compareContact || !existingPerson) return;
    setAddingId(compareContact.id);
    const ok = await updateExistingContact(
      existingPerson.id,
      compareContact,
      selectedFields,
      sectors
    );
    setAddingId(null);
    if (ok) {
      setAddedIds((prev) => new Set([...prev, compareContact.id]));
      onContactAdded();
    }
    setCompareContact(null);
    setExistingPerson(null);
  };

  const handleAddNewFromCompare = async () => {
    if (!compareContact) return;
    setAddingId(compareContact.id);
    const ok = await addContactToDb(compareContact, sectors);
    setAddingId(null);
    if (ok) {
      setAddedIds((prev) => new Set([...prev, compareContact.id]));
      onContactAdded();
    }
    setCompareContact(null);
    setExistingPerson(null);
  };

  const handleSaveEdit = (updated: DiscoveredContact) => {
    setDiscoveredContacts((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
    setEditingId(null);
  };

  const nonDupeCount = discoveredContacts.filter(
    (c) => !addedIds.has(c.id) && !c.is_duplicate
  ).length;

  return (
    <div className="flex h-[38rem]">
      <div className="w-[42%] flex flex-col border-r border-gray-100">
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-yellow-50 border border-yellow-100 rounded-2xl rounded-br-sm px-5 py-3 max-w-[88%]">
                    <p className="text-sm text-gray-800 leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start space-x-2.5">
                  <div className="w-7 h-7 rounded-lg bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-yellow-700" />
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-5 py-3 max-w-[88%]">
                    <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
          {processing && (
            <div className="flex items-start space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-yellow-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-yellow-700" />
              </div>
              <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-2xl px-5 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />
                <span className="text-sm text-gray-500">
                  Searching the web...
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend();
                }}
                placeholder="Search for a person or group..."
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                disabled={processing}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || processing}
              className="p-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-100 disabled:text-gray-400 text-white rounded-xl transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="w-[58%] flex flex-col bg-gray-50/50">
        {loadingCompare ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : compareContact && existingPerson ? (
          <DuplicateCompare
            newContact={compareContact}
            existingPerson={existingPerson}
            onUpdate={handleUpdate}
            onAddNew={handleAddNewFromCompare}
            onBack={() => {
              setCompareContact(null);
              setExistingPerson(null);
            }}
          />
        ) : discoveredContacts.length > 0 ? (
          <>
            <div className="px-5 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">
                  Discovered Contacts
                </h3>
                <span className="text-xs text-gray-400">
                  ({discoveredContacts.length})
                </span>
              </div>
              {nonDupeCount > 1 && (
                <button
                  onClick={handleAddAll}
                  className="flex items-center gap-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Add All ({nonDupeCount})</span>
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {discoveredContacts.map((contact) => {
                if (editingId === contact.id) {
                  return (
                    <ContactCardEdit
                      key={contact.id}
                      contact={contact}
                      onSave={handleSaveEdit}
                      onCancel={() => setEditingId(null)}
                    />
                  );
                }
                return (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    isAdded={addedIds.has(contact.id)}
                    isAdding={addingId === contact.id}
                    onAdd={handleAdd}
                    onEdit={(c) => setEditingId(c.id)}
                    onCompare={handleCompare}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-8">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Users className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">
              No contacts yet
            </p>
            <p className="text-xs text-gray-400 text-center leading-relaxed">
              Search for a person or group in the chat to see discovered contacts
              here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
