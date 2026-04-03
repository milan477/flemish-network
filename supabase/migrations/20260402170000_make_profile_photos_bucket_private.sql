-- Ensure internal profile photos are not publicly readable at the bucket level.

UPDATE storage.buckets
SET public = false
WHERE id = 'profile-photos'
  AND public IS DISTINCT FROM false;
