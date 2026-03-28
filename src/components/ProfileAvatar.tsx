import { useState, useEffect } from 'react';
import { personInitials } from '../lib/supabase';
import type { Person } from '../lib/supabase';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CONFIG: Record<AvatarSize, { container: string; text: string; pixels: number }> = {
  xs: { container: 'w-8 h-8', text: 'text-[10px]', pixels: 64 },
  sm: { container: 'w-10 h-10', text: 'text-xs', pixels: 80 },
  md: { container: 'w-12 h-12', text: 'text-sm', pixels: 96 },
  lg: { container: 'w-24 h-24', text: 'text-3xl', pixels: 192 },
};

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type AvatarVariant = 'light' | 'dark';

const VARIANT_CLASSES: Record<AvatarVariant, { bg: string; text: string }> = {
  light: { bg: 'bg-gradient-to-br from-blue-100 to-blue-200', text: 'text-blue-700' },
  dark: { bg: 'bg-gradient-to-br from-blue-500 to-blue-600', text: 'text-white' },
};

interface ProfileAvatarProps {
  person: Pick<Person, 'name' | 'first_name' | 'last_name' | 'email' | 'profile_photo_url'>;
  size?: AvatarSize;
  variant?: AvatarVariant;
  className?: string;
}

export function ProfileAvatar({ person, size = 'md', variant = 'light', className = '' }: ProfileAvatarProps) {
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
  const [imgState, setImgState] = useState<'photo' | 'gravatar' | 'initials'>('initials');

  const s = SIZE_CONFIG[size];
  const v = VARIANT_CLASSES[variant];
  const initials = personInitials(person);

  useEffect(() => {
    if (person.email) {
      sha256Hex(person.email.trim().toLowerCase()).then((hash) => {
        setGravatarUrl(`https://gravatar.com/avatar/${hash}?d=404&s=${s.pixels}`);
      });
    } else {
      setGravatarUrl(null);
    }
  }, [person.email, s.pixels]);

  useEffect(() => {
    if (person.profile_photo_url) {
      setImgState('photo');
    } else if (person.email) {
      setImgState('gravatar');
    } else {
      setImgState('initials');
    }
  }, [person.profile_photo_url, person.email]);

  const handleImgError = () => {
    if (imgState === 'photo' && person.email) {
      setImgState('gravatar');
    } else {
      setImgState('initials');
    }
  };

  if (imgState === 'photo' && person.profile_photo_url) {
    return (
      <img
        src={person.profile_photo_url}
        alt={person.name || 'Profile'}
        className={`${s.container} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={handleImgError}
      />
    );
  }

  if (imgState === 'gravatar' && gravatarUrl) {
    return (
      <img
        src={gravatarUrl}
        alt={person.name || 'Profile'}
        className={`${s.container} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={() => setImgState('initials')}
      />
    );
  }

  return (
    <div
      className={`${s.container} rounded-full ${v.bg} flex items-center justify-center flex-shrink-0 ${className}`}
    >
      <span className={`${s.text} font-semibold ${v.text}`}>{initials}</span>
    </div>
  );
}
