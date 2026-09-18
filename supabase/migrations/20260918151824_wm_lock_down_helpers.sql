-- Not part of the API: they answer only about the caller, and the policies
-- that use them run for signed-in users. Nobody signed out needs them.
revoke execute on function public.wm_is_active() from anon, public;
revoke execute on function public.wm_is_admin()  from anon, public;
grant  execute on function public.wm_is_active() to authenticated;
grant  execute on function public.wm_is_admin()  to authenticated;
