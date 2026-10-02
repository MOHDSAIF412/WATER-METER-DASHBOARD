# Keeping the login awake — one thing to switch on

The login service (Supabase, free plan) **puts itself to sleep after about a week
with no requests**. That happened: the dashboard went unopened for two weeks, the
project paused, and nobody could sign in. It went unnoticed because a device that
had signed in before still opened the dashboard — only new sign-ins failed.

`keep-login-awake.yml` asks the login service one harmless question every morning,
which is enough to count as use. It reads nothing private: the key in it is the
publishable one, already public in `auth.js`, and the table it reads only records
whether the first administrator has been set up.

## Switch it on (about a minute, in the browser)

1. Open the repository on GitHub → **Actions** tab.
2. **New workflow** → **set up a workflow yourself**.
3. Name the file `keep-login-awake.yml`, delete the sample content, and paste in
   everything from `tools/keep-login-awake.yml` in this repository.
4. **Commit changes**.
5. Back on the **Actions** tab, open *Keep the login awake* → **Run workflow** to
   prove it works. It should finish green and print `Login service is awake.`

From then on it runs itself every day at 10:17 Dubai time.

GitHub switches scheduled jobs off in a repository that has had no commits for 60
days; it emails first. If that happens, press **Run workflow** once to re-enable it.

## If the login is already asleep

Waking it is one click: open the project at <https://supabase.com/dashboard>, and
press **Restore**. It takes a couple of minutes, and nothing is lost — accounts,
passwords and settings all survive a pause.

## Worth doing at the same time

In the same Supabase dashboard, under **Authentication → Sign In / Providers**,
turn **"Allow new users to sign up"** off. Right now anybody on the internet can
create an account in the project. They cannot see the dashboard — they land on
"No access yet", because access is granted only by an administrator — but there is
no reason to let strangers make accounts at all. Turning it off does **not** affect
adding staff from the Users screen: that runs on the server with its own key.
