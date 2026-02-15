import { useState, useRef, useEffect } from 'react';
import { Send, Plus, Bot, X, MessageSquare, Loader2 } from 'lucide-react';
import { supabase, type Person, displayName } from '../lib/supabase';
import { suggestPeople } from '../lib/aiService';
import { getEventTypeConfig, type Plan } from '../lib/plannerUtils';

interface SuggestionWithReason {
  person: Person;
  reason: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: SuggestionWithReason[];
  addedIds?: Set<string>;
}

interface PlannerChatbotProps {
  plan: Plan;
  existingPersonIds: string[];
  onAddPerson: (person: Person, reason?: string) => Promise<void>;
  isOpen: boolean;
  onToggle: () => void;
}

export default function PlannerChatbot({
  plan,
  existingPersonIds,
  onAddPerson,
  isOpen,
  onToggle,
}: PlannerChatbotProps) {
  const config = getEventTypeConfig(plan.event_type);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `I can help you find contacts for this ${config.label.toLowerCase()}. Try asking:\n\n- "Who else would be a good fit?"\n- "Find people in San Francisco"\n- "Suggest AI researchers"\n- "Anyone available for lectures?"`,
    },
  ]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [addedInChat, setAddedInChat] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, searching]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const addBotMessage = (
    content: string,
    suggestions?: SuggestionWithReason[]
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        suggestions,
      },
    ]);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || searching) return;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: trimmed },
    ]);
    setInput('');
    setSearching(true);

    try {
      const allExcluded = [...existingPersonIds, ...addedInChat];

      const { data: allPeople } = await supabase.from('people').select('*');

      const available = (allPeople || []).filter(
        (p) => !allExcluded.includes(p.id)
      );

      const planContext = {
        title: plan.title,
        event_type: plan.event_type,
        topic: plan.topic,
        location: plan.location,
        dates_description: plan.dates_description,
      };

      const result = await suggestPeople(trimmed, planContext, available);

      const reasonMap = new Map<string, string>();
      if (result.suggestions) {
        for (const s of result.suggestions) {
          reasonMap.set(s.id, s.reason);
        }
      }

      const suggestedWithReasons: SuggestionWithReason[] =
        result.suggested_person_ids
          .map((id) => {
            const person = available.find((p) => p.id === id);
            if (!person) return null;
            return {
              person,
              reason: reasonMap.get(id) || '',
            };
          })
          .filter((s): s is SuggestionWithReason => !!s);

      addBotMessage(
        result.message,
        suggestedWithReasons.length > 0 ? suggestedWithReasons : undefined
      );
    } catch {
      addBotMessage(
        'I had trouble searching the network. Please try again with a different query.'
      );
    }

    setSearching(false);
  };

  const handleAddPerson = async (
    suggestion: SuggestionWithReason,
    msgId: string
  ) => {
    await onAddPerson(suggestion.person, suggestion.reason);
    setAddedInChat((prev) => new Set([...prev, suggestion.person.id]));
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          return {
            ...m,
            addedIds: new Set([
              ...(m.addedIds || []),
              suggestion.person.id,
            ]),
          };
        }
        return m;
      })
    );
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 w-14 h-14 bg-yellow-400 hover:bg-yellow-500 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-105 z-50"
        title="Open Planning Assistant"
      >
        <MessageSquare className="w-6 h-6 text-gray-900" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[22rem] sm:w-96 h-[34rem] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden animate-in">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center">
            <Bot className="w-4.5 h-4.5 text-yellow-700" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">
              Planning Assistant
            </h3>
            <p className="text-[11px] text-gray-400">
              Find contacts and inspiration for your plan
            </p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="bg-yellow-50 border border-yellow-100 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%]">
                  <p className="text-sm text-gray-800">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[90%]">
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                    {msg.content}
                  </p>
                </div>
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="space-y-1.5 pl-1">
                    {msg.suggestions.map((suggestion) => {
                      const isAdded =
                        msg.addedIds?.has(suggestion.person.id) ||
                        addedInChat.has(suggestion.person.id);
                      return (
                        <div
                          key={suggestion.person.id}
                          className={`border rounded-xl px-3 py-2.5 transition-all ${
                            isAdded
                              ? 'bg-green-50/60 border-green-200'
                              : 'bg-white border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {displayName(suggestion.person)}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {suggestion.person.current_position}
                                {suggestion.person.location_city &&
                                  ` · ${suggestion.person.location_city}`}
                              </p>
                            </div>
                            {isAdded ? (
                              <span className="text-xs text-green-600 font-medium px-2 flex-shrink-0">
                                Added
                              </span>
                            ) : (
                              <button
                                onClick={() =>
                                  handleAddPerson(suggestion, msg.id)
                                }
                                className="flex items-center space-x-1 text-xs font-medium text-yellow-700 hover:text-yellow-800 bg-yellow-50 hover:bg-yellow-100 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 ml-2"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add</span>
                              </button>
                            )}
                          </div>
                          {suggestion.reason && (
                            <p className="text-xs text-gray-500 mt-1 italic line-clamp-1">
                              {suggestion.reason}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {searching && (
          <div className="flex items-center space-x-2 text-gray-400 py-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Searching the network...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder="Ask for suggestions..."
            className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
            disabled={searching}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || searching}
            className="p-2.5 bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-100 disabled:text-gray-400 text-gray-900 rounded-xl transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
