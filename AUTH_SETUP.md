# Dashboard accounts

Accounts are **already switched on**. Nothing needs installing.

- **Staff sign in with a user name** — `ahmed`, `store.keeper`, `site-2`. No
  email address, no mailbox, nothing to register.
- **One login for every device.** The same user name and password open the
  dashboard on any PC, laptop or phone.
- **The password is not kept in this website, and not in Chrome.** It is checked
  by the login service (Supabase) and stored there only as a hash. What stays in
  the browser is a session token that expires and can be cancelled.
- **Forgotten passwords are an administrator's job.** Users screen → **New
  password** on that person's row.
- **Users screen** (left menu → Users): administrators add people, make them
  administrator or viewer, and disable access.

## First run — the administrator

1. Open the dashboard. On the sign-in screen click **First-time setup**.
   (It only appears while no administrator exists.)
2. Enter your name, **a real email address** and a password of at least 8
   characters.
3. That account becomes the administrator. If the login service asks you to
   confirm the address first, open the emailed link, then sign in.

The administrator uses an email address on purpose: it is the one account that
can reset **itself** with "Forgotten your password?", without having to ask
anybody. After this, **First-time setup** disappears for everyone.

## Adding people

Left menu → **Users** → *Add a user*:

| Field | What to put |
| --- | --- |
| Name | The person's name, for the list |
| User name | 3–32 characters: letters, numbers, dot, dash, underscore |
| Role | **Viewer** sees the dashboard; **Administrator** can also manage users |
| Password | Leave empty and one is made up and shown **once** — or type one of at least 8 characters |

Copy the password and pass it on. That is the whole account: they sign in with
the user name and that password, from any device.

You may type an **email address** in the user name box instead. That account
then also gets "Forgotten your password?" by email, like the administrator.

## When someone forgets their password

Users screen → **New password** on their row. Type one, or leave it empty for a
made-up one. It is shown once; tell them what it is. They are not signed out of
other devices by this, so tell them to sign in again with the new password.

There is no self-service reset for user-name accounts, by design — there is no
address to send anything to.

## Taking access away

Press **Disable**. They are signed out within two minutes, even if the
dashboard is open in front of them, and cannot get back in until you enable
them again. The account keeps its history; nothing is deleted.

## Where it runs

| Piece | Where |
| --- | --- |
| Accounts and passwords | Supabase project `OPERON Water Dashboard` (Mumbai) |
| Who may open the dashboard | table `wm_profiles`, guarded by row-level security |
| Adding, re-passwording, removing | server function `wm-users` — checks the caller is an administrator |
| Settings in this repo | `auth.js`, top of the file |

A user name is stored underneath as `name@users.operon.invalid`. The `.invalid`
ending can never be registered or delivered to, so no mail is ever sent there
and nobody can claim the address.

The project URL and publishable key in `auth.js` are public by design; they
grant nothing on their own. Every rule is enforced on Supabase's servers, not
in the page, so editing the page in a browser gains no access.

## The 3PhTech platform login

That is separate and stays on each device: the page asks for it once and keeps
it in that browser. It is deliberately **not** shared through the accounts
database, so a working platform password is never sitting in a table that every
signed-in person could read.
