# Server side of the dashboard login

What lives here is a copy of what is already running in the Supabase project
`OPERON Water Dashboard`, kept in the repo so the rules can be read and
reviewed. Applying these files is only needed to rebuild the project from
scratch.

- `migrations/` - the tables and the row-level security rules that decide who
  may read or change what.
- `functions/wm-users/` - the server function that creates, re-passwords and
  removes accounts. It holds the service key (as an environment variable
  supplied by Supabase, never in the code) and refuses anyone who is not a
  signed-in administrator of this dashboard.

See ../AUTH_SETUP.md for how the login works day to day.
