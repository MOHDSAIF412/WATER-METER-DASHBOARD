# Email to 3PhTech — request for a read-only service account

**To:** (your 3PhTech account manager / support contact)
**Subject:** TCT water-meter dashboard — request for a read-only service account

---

Hi [name],

We've built an internal operations dashboard for our TCT water and flow meters
that reads live data from your platform (platform.3phtechsolutions.com) using the
same `/data/api/v1` endpoints the web portal uses. It's read-only and runs on a
single machine in our operations office.

For reference, our account is `admin@tct.com`, org TCT
(`d48c65a0-bfa5-11f0-a573-a314e8899d81`), covering 17 water and flow meters.

It currently signs in with the same `/login` endpoint the portal uses and renews
its own session, so it's working. Before we leave it running permanently, we'd
like to set it up properly on your side rather than have it use a person's
admin login. Could you please help with the following:

**1. A dedicated read-only user for the dashboard** (e.g. `dashboard@tct.com`)
   on org TCT, with read access only to our own devices — device list, latest
   readings, daily/monthly consumption, alarms, and device connection status.
   No write, no configuration, no user management.

**2. Confirmation on concurrent sessions.** If the dashboard signs in while a
   colleague is logged into the portal on the same account, does the newer login
   invalidate the older session's token? This is the main reason we'd like a
   separate account rather than sharing `admin@tct.com`.

**3. If you offer one, an API key or long-lived token** for that user instead of
   an email/password pair. We'd prefer not to store a password on the dashboard
   machine at all, so a static key we can send in a header would be better for
   both of us.

**4. Your lockout and rate-limit policy** — we've seen the
   `account locked, contact admin or try after 1 hour` response, so we want to
   make sure our polling interval and sign-in behaviour stay well inside your
   limits. The dashboard currently polls every 30 seconds and signs in roughly
   once a day.

If there's any API documentation or an integration guide for the `/data/api/v1`
endpoints, please share that as well.

Thanks very much,
Mohammed Saif Shaikh
TCT
