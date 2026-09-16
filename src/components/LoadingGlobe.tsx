import { Earth } from 'lucide-react';

interface BrandGlobeProps {
  className?: string;
  spinning?: boolean;
}

export function BrandGlobe({
  className = 'h-7 w-7',
  spinning = false,
}: BrandGlobeProps) {
  return (
    <Earth
      className={`${className} text-yellow-300 ${
        spinning ? 'animate-spin motion-reduce:animate-none' : ''
      }`}
      aria-hidden="true"
    />
  );
}

export default function LoadingGlobe({
  className = 'h-10 w-10',
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className="inline-flex items-center justify-center" role="status" aria-label={label}>
      <BrandGlobe className={className} spinning />
    </div>
  );
}
