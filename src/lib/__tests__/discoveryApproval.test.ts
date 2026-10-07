import { describe, expect, it } from 'vitest';
import { lastVerifiedAtAfterMerge, verifiedAtForApproval } from '../discoveryApproval';

describe('verifiedAtForApproval', () => {
  it('carries the verification date of a verified candidate onto the new profile', () => {
    expect(
      verifiedAtForApproval({ verification_status: 'verified', verified_at: '2026-09-29T20:13:50Z' })
    ).toBe('2026-09-29T20:13:50Z');
  });

  it('leaves the profile unverified when the candidate was never verified', () => {
    expect(verifiedAtForApproval({ verification_status: 'queued', verified_at: null })).toBeNull();
    expect(
      verifiedAtForApproval({ verification_status: 'failed', verified_at: '2026-09-29T20:13:50Z' })
    ).toBeNull();
  });
});

describe('lastVerifiedAtAfterMerge', () => {
  const verified = { verification_status: 'verified', verified_at: '2026-10-07T18:39:06Z' };

  it('sets the date on a profile that was never verified', () => {
    expect(lastVerifiedAtAfterMerge(null, verified)).toBe('2026-10-07T18:39:06Z');
  });

  it('only moves the date forward', () => {
    expect(lastVerifiedAtAfterMerge('2026-09-01T00:00:00Z', verified)).toBe('2026-10-07T18:39:06Z');
    expect(lastVerifiedAtAfterMerge('2026-10-08T00:00:00Z', verified)).toBeNull();
  });

  it('changes nothing for an unverified candidate', () => {
    expect(lastVerifiedAtAfterMerge(null, { verification_status: 'queued', verified_at: null })).toBeNull();
  });
});
