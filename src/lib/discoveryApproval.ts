/**
 * A candidate that passed Verification has already had its deeper source
 * check, so the profile it becomes (or merges into) is verified as of that
 * check. Without this, every record added from Verification read "Unverified".
 */
interface VerifiedCandidate {
  verification_status?: string | null;
  verified_at?: string | null;
}

export function verifiedAtForApproval(contact: VerifiedCandidate): string | null {
  return contact.verification_status === 'verified' ? contact.verified_at || null : null;
}

/** The new `last_verified_at` for a merge target, or null when it should not change. */
export function lastVerifiedAtAfterMerge(
  existingLastVerifiedAt: string | null | undefined,
  contact: VerifiedCandidate
): string | null {
  const verifiedAt = verifiedAtForApproval(contact);
  if (!verifiedAt) return null;
  if (existingLastVerifiedAt && Date.parse(existingLastVerifiedAt) >= Date.parse(verifiedAt)) {
    return null;
  }
  return verifiedAt;
}
