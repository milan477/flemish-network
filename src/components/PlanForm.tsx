import { useState } from 'react';
import { Sparkles, Calendar, MapPin, MessageSquare, Tag } from 'lucide-react';
import { EVENT_TYPES } from '../lib/plannerUtils';

export interface PlanFormData {
  event_type: string;
  title: string;
  topic: string;
  dates_description: string;
  start_date?: string;
  end_date?: string;
  location: string;
}

interface PlanFormProps {
  onSubmit: (data: PlanFormData) => Promise<void>;
  onCancel: () => void;
}

export default function PlanForm({ onSubmit, onCancel }: PlanFormProps) {
  const [eventType, setEventType] = useState('economic_mission');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [datesDescription, setDatesDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setSubmitting(true);

    const typeLabel =
      EVENT_TYPES.find((t) => t.value === eventType)?.label || 'Event';
    const autoTitle =
      title.trim() || `${typeLabel}: ${topic.slice(0, 60)}`;

    await onSubmit({
      event_type: eventType,
      title: autoTitle,
      topic: topic.trim(),
      dates_description: datesDescription.trim(),
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      location: location.trim(),
    });

    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          Create a New Plan
        </h2>

        <div className="space-y-5">
          <div>
            <label className="flex items-center space-x-1.5 text-sm font-medium text-gray-700 mb-2">
              <Tag className="w-4 h-4" />
              <span>Type of Event</span>
            </label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Title{' '}
              <span className="text-gray-400 font-normal">
                (optional -- auto-generated if left empty)
              </span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Silicon Valley AI Delegation 2026"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="flex items-center space-x-1.5 text-sm font-medium text-gray-700 mb-2">
              <MessageSquare className="w-4 h-4" />
              <span>Topic</span>
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe the topic, theme, or focus area in natural language. The system will match relevant contacts from the network..."
              rows={3}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent resize-none transition-all"
              required
            />
            <p className="mt-1.5 text-xs text-gray-400">
              Mention sectors like AI, biotech, finance, culture, or education for better contact matching
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-1.5 text-sm font-medium text-gray-700 mb-2">
              <Calendar className="w-4 h-4" />
              <span>Dates</span>
            </label>
            <input
              type="text"
              value={datesDescription}
              onChange={(e) => setDatesDescription(e.target.value)}
              placeholder="e.g., Mid-March 2026, First week of April, TBD"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent mb-3 transition-all"
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Precise start (optional)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Precise end (optional)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-all"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="flex items-center space-x-1.5 text-sm font-medium text-gray-700 mb-2">
              <MapPin className="w-4 h-4" />
              <span>Location</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., San Francisco Bay Area, New York City, Virtual"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-3 text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!topic.trim() || submitting}
          className="flex-1 px-6 py-3 bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-100 disabled:text-gray-400 text-gray-900 font-semibold rounded-xl transition-colors flex items-center justify-center space-x-2 text-sm"
        >
          <Sparkles className="w-4 h-4" />
          <span>{submitting ? 'Generating Ideas...' : 'Generate Plan'}</span>
        </button>
      </div>
    </form>
  );
}
