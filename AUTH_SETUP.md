# Turning on dashboard accounts

Once this is set up, the dashboard gets:

- **One login for every device**: sign in with your email and password on any PC or phone.
- **"Forgot password?"**: people get an email link to choose a new password.
- **Users screen** (left menu → Users): administrators add people, make them admin or viewer, send reset links, and disable access.

It runs on **Firebase** (Google), on the free Spark plan. Until you finish step 7 the dashboard keeps its old login, which works in one browser only.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Create a project**, for example `operon-dashboard`. You can turn Google Analytics off.

## 2. Turn on email and password sign-in

1. **Build → Authentication → Get started**.
2. **Sign-in method → Email/Password → Enable → Save**. Leave "Email link" off.
3. **Settings → Authorized domains → Add domain** → `mohdsaif412.github.io`

## 3. Create the database

1. **Build → Firestore Database → Create database**.
2. Choose a location close to you, then **Start in production mode**.

## 4. Add the security rules

This step matters most. The rules stop anyone who isn't an active user from reading anything.

1. **Firestore Database → Rules**.
2. Delete what is there, paste the whole of [`firestore.rules`](firestore.rules), then click **Publish**.

## 5. Register the dashboard as a web app

1. Click the gear icon, then **Project settings → General → Your apps**, then the **`</>`** (Web) icon.
2. Nickname: `OPERON dashboard`. Leave Firebase Hosting **unticked**. Click **Register app**.
3. Copy the `firebaseConfig` block. It looks like this:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "operon-dashboard.firebaseapp.com",
  projectId: "operon-dashboard",
  storageBucket: "operon-dashboard.appspot.com",
  messagingSenderId: "…",
  appId: "1:…:web:…"
};
```

These values aren't secret. They only name the project. The rules from step 4 are what protect the data.

## 6. Paste it into `auth.js`

Near the top of [`auth.js`](auth.js), replace

```js
var FIREBASE_CONFIG = null;
```

with

```js
var FIREBASE_CONFIG = {
  apiKey: "AIza…",
  authDomain: "operon-dashboard.firebaseapp.com",
  projectId: "operon-dashboard",
  storageBucket: "operon-dashboard.appspot.com",
  messagingSenderId: "…",
  appId: "1:…:web:…"
};
```

Then upload the change to GitHub. The site updates within about a minute.

## 7. Create your administrator account

1. Open the dashboard. You'll see a new **Sign in** screen.
2. Click **First-time setup**. Enter your name, email and a password (at least 8 characters).
3. That account is now the administrator. The setup link disappears for good.

## 8. Connect 3PhTech once for everyone

As the administrator, click **🔑 Key** and sign in to the 3PhTech platform. The platform login is saved with the accounts, so every signed-in person on every device goes live without typing it. Use a **read-only** 3PhTech account if you can.

## 9. Add people

**Users → Add a user**: enter a name and email, and pick Viewer or Administrator.

- **Leave the password empty** (recommended): they get an email to choose their own password.
- Or type a password and give it to them yourself.

**Viewers** see the dashboard. **Administrators** can also manage users.

---

## Good to know

- **Reset emails** come from `noreply@<your-project>.firebaseapp.com`. Ask people to check their spam folder the first time. You can change the wording under **Authentication → Templates → Password reset**.
- **Disable** in the Users screen removes access straight away, even for someone who has the dashboard open. **Enable** gives it back.
- **Deleting an account completely**: Firebase console → **Authentication → Users → ⋮ → Delete account**. Usually Disable is enough.
- Administrators can't disable or demote themselves, so the dashboard can never be left without an admin. To hand over, make someone else an administrator first.
- **Signing out** (🔒 button) also clears the 3PhTech session stored on that device.
