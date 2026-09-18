/* ============================================================
   OPERON shared login  (Supabase Authentication)

   Used by index.html and aareport.html.

   The account lives on Supabase's servers, NOT in this website and not in
   Chrome. The password is never written to the page, to localStorage, or to
   this file - it is sent once to Supabase, which stores only a hash. What the
   browser keeps afterwards is a session token that expires and can be revoked,
   which is why the SAME login works on any computer or phone: sign in from
   anywhere and you see the same dashboard.

   Staff sign in with a USER NAME - no email address needed, and no mailbox to
   own. An administrator gives them a new password when they forget it. The
   administrator's own account uses a real email address, so it can use the
   "Forgot password" link without depending on anybody else.

   Administrators add and remove people from the dashboard's Users screen; that
   runs on the server (the wm-users function), because creating an account
   needs a key no browser may hold.

   Who may read or change what is enforced by row-level security on Supabase's
   servers - not by this file, which anyone can read. The keys below are the
   public ones, meant to be published; they grant nothing on their own.
   ============================================================ */
(function(){
  'use strict';

  var SUPABASE_URL = 'https://ugcclyogdubrjlhwkyew.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_bsIWMjeMrBej7JislwVRHQ_aAQ8bmu7';
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js';

  /* Staff sign in with a user name. Supabase always needs an email address
     underneath, so one is made up on this domain - .invalid can never be
     registered or routed, so nothing is ever sent there and nobody needs a
     mailbox. Type "ahmed" and it becomes ahmed@users.operon.invalid.        */
  var INTERNAL_DOMAIN = 'users.operon.invalid';
  function toEmail(login){
    login = String(login || '').trim();
    return login.indexOf('@') >= 0 ? login : login.toLowerCase() + '@' + INTERNAL_DOMAIN;
  }
  /* what to show a person: their user name, or their address if they have one */
  function loginOf(p){
    if (!p) return '';
    return p.username || String(p.email || '').replace('@' + INTERNAL_DOMAIN, '');
  }
  function hasMailbox(p){ return !!(p && p.real_email && String(p.email || '').indexOf('@' + INTERNAL_DOMAIN) < 0); }

  var ON = !!(SUPABASE_URL && SUPABASE_KEY);
  var sb = null, ready = null;

  function loadScript(src){
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = function(){ rej(new Error('Could not load the login service. Check the internet connection.')); };
      document.head.appendChild(s);
    });
  }

  /* The SDK is only downloaded when it is first needed. */
  function boot(){
    if (ready) return ready;
    ready = loadScript(SDK).then(function(){
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    });
    ready.catch(function(){ ready = null; });      // allow a retry after a network failure
    return ready;
  }

  var MSG = {
    'invalid_credentials':  'User name or password is incorrect.',
    'invalid_grant':        'User name or password is incorrect.',
    'email_not_confirmed':  'Confirm your email address first - check your inbox for the link.',
    'user_already_exists':  'That login is already taken.',
    'email_exists':         'That login is already taken.',
    'weak_password':        'Password is too weak. Use at least 8 characters.',
    'over_email_send_rate_limit': 'Too many emails sent. Wait a few minutes and try again.',
    'over_request_rate_limit':    'Too many attempts. Wait a few minutes and try again.',
    'validation_failed':    'That login is not valid.',
    'signup_disabled':      'New sign-ups are switched off. Ask an administrator for an account.'
  };
  function friendly(e){
    if (!e) return 'Something went wrong.';
    if (e.code && MSG[e.code]) return MSG[e.code];
    var m = String(e.message || e);
    if (/Invalid login credentials/i.test(m)) return MSG.invalid_credentials;
    if (/Email not confirmed/i.test(m))       return MSG.email_not_confirmed;
    if (/already registered|already exists/i.test(m)) return MSG.email_exists;
    if (/Anonymous sign-ins|Signups not allowed/i.test(m)) return MSG.signup_disabled;
    if (/Failed to fetch|NetworkError/i.test(m))     return 'Cannot reach the login service. Check the connection.';
    return m;
  }
  function fail(e){ var err = new Error(friendly(e)); err.code = e && e.code; throw err; }

  /* ---- staying signed in ----
     Supabase already keeps the session on this device and renews it by itself,
     so signing in once is meant to last. What it cannot do is survive a slow
     or missing network at the moment the page opens: the check would fail and
     the dashboard would ask for a password it does not actually need. So the
     last successful sign-in is remembered here - who you are and what you may
     see, never the password - and the page opens on that while the real check
     runs behind it. The password is never written down anywhere: only a token
     that expires, can be revoked, and is useless on another device.         */
  var ME = 'wm_me';
  function remember(me){
    try{ localStorage.setItem(ME, JSON.stringify({ uid: me.uid, email: me.email, login: me.login,
           mailbox: me.mailbox, allowed: me.allowed, admin: me.admin, profile: me.profile, at: Date.now() })); }
    catch(e){}
  }
  function cached(){
    try{ var m = JSON.parse(localStorage.getItem(ME) || 'null'); return m && m.uid ? m : null; }
    catch(e){ return null; }
  }
  function forget(){ try{ localStorage.removeItem(ME); }catch(e){} }

  /* the page to come back to after a password reset */
  function here(){ return location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html'; }

  /* ---- who is signed in ---- */

  /* {uid, email, profile, allowed, admin} - `allowed` is false for someone with
     an account whose dashboard access has not been granted or was withdrawn. */
  function describe(user){
    return sb.from('wm_profiles').select('*').eq('id', user.id).maybeSingle()
      .then(function(r){
        if (r.error) throw r.error;
        var p = r.data || null;
        var allowed = !!(p && p.active === true);
        var me = { uid: user.id, email: user.email, profile: p,
                   login: loginOf(p) || String(user.email || '').replace('@' + INTERNAL_DOMAIN, ''),
                   mailbox: hasMailbox(p),
                   allowed: allowed, admin: allowed && p.role === 'admin' };
        remember(me);
        return me;
      }, function(err){
        /* the account database could not be reached. If this device signed in
           before, carry on as that person rather than demanding a password. */
        var m = cached();
        if (m && m.uid === user.id){ m.offline = true; return m; }
        throw err;
      });
  }

  /* Whoever is already signed in on this device, or null. Also finishes the
     first-run claim if the administrator confirmed by email and came back. */
  function session(){
    return boot().then(function(){ return sb.auth.getSession(); })
      .then(function(r){
        var u = r.data && r.data.session && r.data.session.user;
        if (!u) return null;
        return describe(u).then(function(me){
          return me.profile ? me : claimIfFirst(u).then(function(c){ return c || me; });
        });
      });
  }

  /* `login` is a user name or an email address - both reach the same account */
  function signIn(login, pass){
    return boot()
      .then(function(){ return sb.auth.signInWithPassword({ email: toEmail(login), password: pass }); })
      .then(function(r){
        if (r.error) fail(r.error);
        return describe(r.data.user).then(function(me){
          return me.profile ? me : claimIfFirst(r.data.user).then(function(c){ return c || me; });
        });
      });
  }

  function signOut(){ forget(); return boot().then(function(){ return sb.auth.signOut(); }); }

  /* Only accounts with a real mailbox can be emailed. A user-name account has
     no address to send to; an administrator sets its password instead.      */
  function sendReset(email){
    email = String(email).trim();
    if (email.indexOf('@') < 0 || email.indexOf('@' + INTERNAL_DOMAIN) >= 0)
      return Promise.reject(new Error('This login has no email address. Ask an administrator to set a new password for you.'));
    return boot()
      .then(function(){ return sb.auth.resetPasswordForEmail(email, { redirectTo: here() }); })
      .then(function(r){ if (r.error) fail(r.error); });
  }

  /* Used by the reset link: the link signs the person in, then they choose. */
  function setPassword(pass){
    return boot().then(function(){ return sb.auth.updateUser({ password: pass }); })
      .then(function(r){ if (r.error) fail(r.error); });
  }

  /* ---- first run: the first account becomes the administrator, once ---- */

  function ownerExists(){
    return boot().then(function(){ return sb.from('wm_meta').select('id').eq('id', 'owner').maybeSingle(); })
      .then(function(r){ return !!r.data; });
  }

  /* Make the signed-in person the administrator, but only while nobody is.
     The rule is enforced on the server, so two people racing cannot both win. */
  function claimIfFirst(user, name){
    return sb.from('wm_profiles').insert({
        id: user.id, email: user.email, name: String(name || (user.user_metadata || {}).name || '').trim(),
        role: 'admin', active: true, created_by: user.id
      })
      .then(function(r){
        if (r.error) return null;                              // someone else was first
        return sb.from('wm_meta').insert({ id: 'owner' }).then(function(){ return describe(user); });
      });
  }

  /* Creates the very first account and makes it the administrator.
     If the project asks for email confirmation, there is no session yet: the
     caller is told to confirm, and the claim happens at the first sign-in.   */
  function createOwner(name, email, pass){
    email = String(email).trim();
    return boot()
      .then(function(){ return sb.auth.signUp({ email: email, password: pass,
                                                options: { data: { name: String(name || '').trim() }, emailRedirectTo: here() } }); })
      .then(function(r){
        if (r.error) fail(r.error);
        if (!r.data.session){
          var e = new Error('Account created. Open the email we just sent, confirm the address, then sign in.');
          e.code = 'confirm-email';
          throw e;
        }
        return claimIfFirst(r.data.user, name).then(function(me){
          if (me) return me;
          throw new Error('Setup has already been completed. Sign in, or ask the administrator for an account.');
        });
      });
  }

  /* ---- administration (the server checks that the caller is an admin) ---- */

  function callAdmin(payload){
    return boot().then(function(){ return sb.auth.getSession(); }).then(function(r){
      var s = r.data && r.data.session;
      if (!s) throw new Error('Your session has expired. Sign in again.');
      return fetch(SUPABASE_URL + '/functions/v1/wm-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY,
                   Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify(payload)
      });
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(j){
        if (!res.ok) throw new Error(j.error || 'That did not work (' + res.status + ').');
        return j;
      });
    });
  }

  /* o = {name, login, role, password?}. `login` is a user name, or an email
     address for someone who should be able to reset it themselves. With no
     password the server makes one and hands it back, once, to pass on.      */
  function createUser(o){
    return callAdmin({ action: 'create', login: o.login || o.email, name: o.name, role: o.role,
                       password: o.password || undefined })
      .then(function(j){ return { uid: j.id, login: j.login, email: j.email, mailbox: !!j.real_email,
                                  password: j.password || null }; });
  }

  /* An administrator gives someone a new password. Left empty, the server
     makes one up and returns it - the only time it is ever shown.           */
  function resetUserPassword(uid, password){
    return callAdmin({ action: 'password', id: uid, password: password || undefined });
  }
  function removeUser(uid){ return callAdmin({ action: 'remove', id: uid }); }

  function listUsers(){
    return boot().then(function(){ return sb.from('wm_profiles').select('*').order('email'); })
      .then(function(r){
        if (r.error) fail(r.error);
        return (r.data || []).map(function(v){ v.uid = v.id; v.login = loginOf(v); v.mailbox = hasMailbox(v); return v; });
      });
  }

  /* patch may hold name, role, active */
  function updateUser(uid, patch){
    var clean = { updated_at: new Date().toISOString() };
    ['name', 'role', 'active'].forEach(function(k){ if (k in patch) clean[k] = patch[k]; });
    return boot().then(function(){ return sb.auth.getSession(); }).then(function(r){
      var s = r.data && r.data.session;
      if (s) clean.updated_by = s.user.id;
      return sb.from('wm_profiles').update(clean).eq('id', uid);
    }).then(function(r){ if (r.error) fail(r.error); });
  }

  /* Calls back when this person's access changes, e.g. an admin disables them.
     Checked on a timer rather than a live socket: one row, every two minutes. */
  function watchProfile(uid, cb){
    var stop = false;
    function look(){
      if (stop) return;
      sb.from('wm_profiles').select('*').eq('id', uid).maybeSingle()
        .then(function(r){ if (!stop) cb(r.data || null); }, function(){});
    }
    var t = setInterval(look, 120000);
    look();
    return function(){ stop = true; clearInterval(t); };
  }

  /* ---- the 3PhTech platform login ----
     Deliberately NOT stored on the server: a shared copy would mean keeping a
     working password in a database that every signed-in person can read. Each
     person enters the platform login once on their own device.               */
  function loadPlatform(){ return Promise.resolve(null); }
  function savePlatform(){ return Promise.resolve(); }

  window.WMAuth = {
    enabled: ON,
    emulator: false,
    session: session, signIn: signIn, loginOf: loginOf, hasMailbox: hasMailbox,
    cached: cached, forget: forget, signOut: signOut, sendReset: sendReset, setPassword: setPassword,
    ownerExists: ownerExists, createOwner: createOwner,
    createUser: createUser, listUsers: listUsers, updateUser: updateUser,
    resetUserPassword: resetUserPassword, removeUser: removeUser, watchProfile: watchProfile,
    loadPlatform: loadPlatform, savePlatform: savePlatform,
    friendly: friendly
  };
})();
