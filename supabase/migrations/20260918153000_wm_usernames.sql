-- Staff sign in with a user name, not an email address. Supabase always needs
-- an address internally, so one is made up on a domain that cannot receive
-- mail (see wm-users). `real_email` says whether the address is a real mailbox
-- - only those accounts can be offered a "forgot password" email; everyone
-- else gets a new password from an administrator.
alter table public.wm_profiles
  add column username   text not null default '',
  add column real_email boolean not null default true;

create unique index wm_profiles_username_key
  on public.wm_profiles (lower(username)) where username <> '';
