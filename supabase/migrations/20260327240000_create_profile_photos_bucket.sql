-- Create a public storage bucket for profile photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read profile photos (public bucket)
CREATE POLICY "Public read profile photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

-- Anyone can upload profile photos (no auth in this app)
CREATE POLICY "Anyone can upload profile photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'profile-photos');

-- Anyone can update their uploads
CREATE POLICY "Anyone can update profile photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'profile-photos');

-- Anyone can delete profile photos
CREATE POLICY "Anyone can delete profile photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'profile-photos');
