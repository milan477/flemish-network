import type { Person } from './supabase';

export interface Plan {
  id: string;
  event_type: string;
  title: string;
  topic: string;
  dates_description: string;
  start_date?: string;
  end_date?: string;
  location: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface PlanWithCounts extends Plan {
  contact_count: number;
  action_count: number;
  completed_action_count: number;
}

export interface PlanSuggestedPerson {
  id: string;
  plan_id: string;
  person_id: string;
  role: string;
  status: string;
  suggestion_reason: string;
  created_at: string;
  people: Person;
}

export interface PlanAction {
  id: string;
  plan_id: string;
  title: string;
  description: string;
  due_date?: string;
  status: string;
  sort_order: number;
  created_at: string;
}

export const EVENT_TYPES = [
  { value: 'economic_mission', label: 'Economic Mission' },
  { value: 'talk', label: 'Talk / Lecture' },
  { value: 'ad_campaign', label: 'Ad Campaign' },
  { value: 'networking_event', label: 'Networking Event' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'conference', label: 'Conference' },
  { value: 'cultural_event', label: 'Cultural Event' },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]['value'];

export function getEventTypeConfig(eventType: string): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (eventType) {
    case 'economic_mission':
      return { label: 'Economic Mission', color: 'text-blue-700', bgColor: 'bg-blue-50' };
    case 'talk':
      return { label: 'Talk / Lecture', color: 'text-green-700', bgColor: 'bg-green-50' };
    case 'ad_campaign':
      return { label: 'Ad Campaign', color: 'text-amber-700', bgColor: 'bg-amber-50' };
    case 'networking_event':
      return { label: 'Networking Event', color: 'text-teal-700', bgColor: 'bg-teal-50' };
    case 'workshop':
      return { label: 'Workshop', color: 'text-sky-700', bgColor: 'bg-sky-50' };
    case 'conference':
      return { label: 'Conference', color: 'text-orange-700', bgColor: 'bg-orange-50' };
    case 'cultural_event':
      return { label: 'Cultural Event', color: 'text-rose-700', bgColor: 'bg-rose-50' };
    default:
      return { label: eventType, color: 'text-gray-700', bgColor: 'bg-gray-50' };
  }
}

export function getDefaultRole(eventType: string): string {
  switch (eventType) {
    case 'economic_mission':
      return 'delegate';
    case 'talk':
      return 'speaker';
    case 'ad_campaign':
      return 'ambassador';
    case 'networking_event':
      return 'attendee';
    case 'workshop':
      return 'facilitator';
    case 'conference':
      return 'panelist';
    case 'cultural_event':
      return 'guest';
    default:
      return 'participant';
  }
}

const TOPIC_SECTOR_MAP: Record<string, string[]> = {
  'Artificial Intelligence': [
    'ai', 'artificial intelligence', 'machine learning', 'deep learning',
    'nlp', 'data science', 'neural', 'algorithm', 'automation', 'robotics',
  ],
  Biotechnology: [
    'biotech', 'pharma', 'genomics', 'gene', 'biomedical', 'clinical',
    'drug', 'therapy', 'health', 'medical', 'oncology', 'biology',
  ],
  Finance: [
    'finance', 'fintech', 'banking', 'investment', 'trading', 'venture',
    'capital', 'economic', 'quantitative', 'fund',
  ],
  'Culture & Arts': [
    'culture', 'art', 'film', 'museum', 'gallery', 'creative', 'design',
    'exhibition', 'media', 'cinema', 'performing',
  ],
  Education: [
    'education', 'academic', 'university', 'teaching', 'student',
    'curriculum', 'learning', 'professor', 'faculty',
  ],
  Research: [
    'research', 'science', 'innovation', 'lab', 'study', 'publication',
    'discovery', 'scientist', 'postdoc', 'phd',
  ],
};

export function matchTopicToSectors(topic: string): string[] {
  const lower = topic.toLowerCase();
  const matched: string[] = [];
  for (const [sector, keywords] of Object.entries(TOPIC_SECTOR_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(sector);
    }
  }
  return matched;
}

export function generateActions(
  eventType: string
): { title: string; description: string }[] {
  switch (eventType) {
    case 'economic_mission':
      return [
        { title: 'Define mission objectives and target outcomes', description: 'Establish the economic goals and partnerships to pursue' },
        { title: 'Identify and invite key industry leaders', description: 'Select participants from relevant sectors and organizations' },
        { title: 'Book venue and accommodations', description: 'Secure meeting spaces and lodging for delegates' },
        { title: 'Draft preliminary agenda', description: 'Create a day-by-day schedule with meetings and site visits' },
        { title: 'Arrange logistics and transportation', description: 'Plan travel between venues and coordinate ground transport' },
        { title: 'Prepare briefing documents', description: 'Compile market data, company profiles, and talking points' },
        { title: 'Send invitations and confirm RSVPs', description: 'Distribute formal invitations and track responses' },
        { title: 'Coordinate with local trade offices', description: 'Align with Flemish trade representatives on the ground' },
        { title: 'Finalize agenda and distribute materials', description: 'Send final schedule and briefing packages to all participants' },
        { title: 'Post-mission reporting and follow-up', description: 'Document outcomes, partnerships formed, and next steps' },
      ];
    case 'talk':
      return [
        { title: 'Confirm speaker availability', description: 'Reach out to suggested speakers and confirm participation' },
        { title: 'Book venue or virtual platform', description: 'Reserve a lecture hall, auditorium, or set up webinar' },
        { title: 'Define talk topic and format', description: 'Finalize the presentation theme, duration, and Q&A format' },
        { title: 'Create promotional materials', description: 'Design flyers, social media posts, and email invitations' },
        { title: 'Distribute invitations', description: 'Send invitations to target audience and track RSVPs' },
        { title: 'Prepare AV equipment and setup', description: 'Ensure microphones, projectors, and recording equipment are ready' },
        { title: 'Brief the speaker on logistics', description: 'Share venue details, timing, and audience profile' },
        { title: 'Post-event follow-up', description: 'Share recording, slides, and thank attendees' },
      ];
    case 'ad_campaign':
      return [
        { title: 'Define target audience and messaging', description: 'Identify who to reach and craft the core message' },
        { title: 'Create creative brief', description: 'Outline visual direction, tone, and key deliverables' },
        { title: 'Identify brand ambassadors from network', description: 'Select contacts who can amplify the campaign' },
        { title: 'Develop campaign assets', description: 'Create graphics, videos, copy, and landing pages' },
        { title: 'Plan media buying strategy', description: 'Choose platforms, set budget, and schedule placements' },
        { title: 'Launch campaign', description: 'Go live across selected channels' },
        { title: 'Monitor performance metrics', description: 'Track impressions, clicks, conversions, and engagement' },
        { title: 'Optimize and iterate', description: 'Adjust targeting, creative, and budget based on data' },
        { title: 'Campaign wrap-up and reporting', description: 'Compile results, ROI analysis, and learnings' },
      ];
    case 'networking_event':
      return [
        { title: 'Define event theme and goals', description: 'Decide on the networking focus and desired outcomes' },
        { title: 'Curate guest list from network', description: 'Select invitees for maximum cross-sector connection potential' },
        { title: 'Book venue and catering', description: 'Secure an appropriate space with food and beverages' },
        { title: 'Create event program', description: 'Plan icebreakers, structured networking, or panel discussions' },
        { title: 'Send invitations', description: 'Distribute invites with event details and RSVP link' },
        { title: 'Prepare name badges and materials', description: 'Print badges, attendee directories, and event guides' },
        { title: 'Post-event networking follow-up', description: 'Share attendee list and facilitate introductions' },
      ];
    case 'workshop':
      return [
        { title: 'Define workshop curriculum', description: 'Outline learning objectives, topics, and hands-on exercises' },
        { title: 'Select facilitators and experts', description: 'Identify subject matter experts to lead sessions' },
        { title: 'Book venue and prepare materials', description: 'Secure space with appropriate setup and print handouts' },
        { title: 'Set up registration', description: 'Create sign-up form and manage capacity' },
        { title: 'Send pre-workshop materials', description: 'Distribute reading materials and preparation instructions' },
        { title: 'Run the workshop', description: 'Execute the planned sessions with interactive components' },
        { title: 'Collect feedback', description: 'Distribute evaluation forms and gather participant input' },
        { title: 'Share workshop resources', description: 'Send slides, recordings, and additional resources to attendees' },
      ];
    case 'conference':
      return [
        { title: 'Form organizing committee', description: 'Assemble a team to manage different aspects of the conference' },
        { title: 'Issue call for speakers', description: 'Solicit presentations and panel proposals from the community' },
        { title: 'Secure keynote speakers', description: 'Invite prominent figures to deliver keynote addresses' },
        { title: 'Book venue and vendors', description: 'Reserve conference center, AV, catering, and logistics' },
        { title: 'Build conference agenda', description: 'Organize tracks, sessions, and breaks into a coherent schedule' },
        { title: 'Open registration', description: 'Launch ticketing and registration platform' },
        { title: 'Promote the event', description: 'Market through email, social media, and partner channels' },
        { title: 'Coordinate day-of logistics', description: 'Manage registration desk, room assignments, and volunteer teams' },
        { title: 'Post-conference summary', description: 'Publish proceedings, share recordings, and send thank-yous' },
      ];
    case 'cultural_event':
      return [
        { title: 'Define event concept and cultural theme', description: 'Establish the cultural narrative and artistic direction' },
        { title: 'Identify artists and cultural ambassadors', description: 'Curate performers, speakers, or exhibitors from the network' },
        { title: 'Book venue and technical setup', description: 'Secure a culturally appropriate space with infrastructure' },
        { title: 'Design marketing and outreach', description: 'Create materials that reflect the cultural theme' },
        { title: 'Coordinate with cultural institutions', description: 'Partner with museums, galleries, or cultural organizations' },
        { title: 'Manage event production', description: 'Oversee setup, rehearsals, and day-of coordination' },
        { title: 'Document the event', description: 'Capture photos, videos, and testimonials' },
        { title: 'Follow up and build on connections', description: 'Foster ongoing cultural exchange relationships' },
      ];
    default:
      return [
        { title: 'Define objectives and success metrics', description: 'Outline key goals and measurable outcomes' },
        { title: 'Identify and invite participants', description: 'Select contacts from the network' },
        { title: 'Book venue and arrange logistics', description: 'Secure location and plan logistics' },
        { title: 'Send invitations and track RSVPs', description: 'Distribute invitations and manage responses' },
        { title: 'Execute the event', description: 'Run the event according to plan' },
        { title: 'Post-event follow-up and reporting', description: 'Share summary, thank participants, and outline next steps' },
      ];
  }
}
