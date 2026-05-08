-- Remove avatar_url from staff_users; the column was never actively used.
ALTER TABLE public.staff_users DROP COLUMN IF EXISTS avatar_url;
