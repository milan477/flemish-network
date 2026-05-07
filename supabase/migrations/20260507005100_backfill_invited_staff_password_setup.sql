-- Existing invited staff predate the password setup flag.
-- Mark them as requiring first-password setup if they later accept an invite.

UPDATE public.staff_users
SET password_reset_required = true
WHERE status = 'invited';

