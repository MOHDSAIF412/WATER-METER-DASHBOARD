# Dashboard accounts

Accounts are **already switched on**. Nothing needs installing.

- **One login for every device.** The same email and password open the dashboard
  on any PC, laptop or phone — at the office, at home, anywhere.
- **The password is not kept in this website, and not in Chrome.** It is checked
  by the login service (Supabase) and stored there only as a hash. What stays in
  the browser is a session token that expires and can be cancelled.
- **"Forgot password?"** emails a link to choose a new one.
- **Users screen** (left menu → Users): administrators add people, make them
  administrator or viewer, and disable access.

## First run

1. Open the dashboard. On the sign-in screen click **First-time setup**.
   (It only appears while no administrator exists.)
2. Enter your name, your email and a password of at least 8 characters.
3. That account becomes the administrator. If the login service asks you to
   confirm the email address first, open the emailed link, then sign in.

After that, **First-time setup** disappears for everyone.

## Adding people

Left menu → **Users** → *Add a user*: name, email, Viewer or Administrator.

- Leave the password box empty and one is made up for you and shown **once** —
  copy it and pass it on. They can change it from "Forgot password?".
- Or type a password of at least 8 characters and tell them what it is.

**Viewer** sees the dashboard. **Administrator** can also manage users.

To take access away, press **Disable**. They are signed out within two minutes
and cannot open the dashboard again until you enable them.

## Where it runs

| Piece | Where |
| --- | --- |
| Accounts and passwords | Supabase project `OPERON Water Dashboard` (Mumbai) |
| Who may open the dashboard | table `wm_profiles`, guarded by row-level security |
| Adding and removing accounts | server function `wm-users` — checks the caller is an administrator |
| Settings in this repo | `auth.js`, top of the file |

The project URL and publishable key in `auth.js` are public by design; they
grant nothing on their own. Every rule is enforced on Supabase's servers, not
in the page, so editing the page in a browser gains no access.

## Reset emails to other people

Supabase's built-in mail server only sends to addresses on the project's team,
and is limited to a few messages an hour. That is fine for the administrator.
For everyone else, either hand over the password made up on the Users screen,
or add your own SMTP under *Project Settings → Authentication → SMTP* so
"Forgot password?" reaches any address.

## The 3PhTech platform login

That is separate and stays on each device: the page asks for it once and keeps
it in that browser. It is deliberately **not** shared through the accounts
database, so a working platform password is never sitting in a table that every
signed-in person could read.
