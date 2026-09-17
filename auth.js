/* ============================================================
   OPERON shared login  (Firebase Authentication + Firestore)

   Used by index.html and aareport.html. One account works on every
   device, "Forgot password" emails a reset link, and administrators
   add or disable people from the dashboard's Users screen.

   Who may read or change what is enforced by firestore.rules on
   Google's servers - not by this file, which anyone can read.
   Setup steps: AUTH_SETUP.md
   ============================================================ */
(function(){
  'use strict';

  /* ===== PASTE YOUR FIREBASE WEB CONFIG HERE =====
     Firebase console -> Project settings -> General -> Your apps -> Web app.
     These values only identify the project; they are not secrets.
     Left as null, the dashboard keeps its old per-browser lock.       */
  var FIREBASE_CONFIG = null;

  var SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

  /* Local testing against the Firebase emulators: open the page on
     localhost with ?emu=1. Never active on the published site.        */
  var emu = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]emu=1\b/.test(location.search);
  if (emu && !FIREBASE_CONFIG)
    FIREBASE_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-operon.firebaseapp.com', projectId: 'demo-operon' };

  var app = null, auth = null, db = null, creator = null, sdkReady = null;

  function loadScript(src){
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = function(){ rej(new Error('Could not load the login service. Check the internet connection.')); };
      document.head.appendChild(s);
    });
  }

  /* The SDK is only downloaded when accounts are switched on. */
  function boot(){
    if (sdkReady) return sdkReady;
    sdkReady = loadScript(SDK + 'firebase-app-compat.js')
      .then(function(){ return Promise.all([loadScript(SDK + 'firebase-auth-compat.js'),
                                            loadScript(SDK + 'firebase-firestore-compat.js')]); })
      .then(function(){
        app  = firebase.initializeApp(FIREBASE_CONFIG);
        auth = app.auth();
        db   = app.firestore();
        if (emu){
          auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
          db.useEmulator('127.0.0.1', 8080);
        }
        return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      });
    sdkReady.catch(function(){ sdkReady = null; });   // allow a retry after a network failure
    return sdkReady;
  }

  function stamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
  function userRef(uid){ return db.collection('users').doc(uid); }

  var MSG = {
    'auth/invalid-credential':       'Email or password is incorrect.',
    'auth/invalid-login-credentials':'Email or password is incorrect.',
    'auth/wrong-password':           'Email or password is incorrect.',
    'auth/user-not-found':           'Email or password is incorrect.',
    'auth/invalid-email':            'That email address is not valid.',
    'auth/missing-email':            'Enter an email address.',
    'auth/too-many-requests':        'Too many attempts. Wait a few minutes or reset your password.',
    'auth/user-disabled':            'This account has been disabled.',
    'auth/email-already-in-use':     'An account with this email already exists.',
    'auth/weak-password':            'Password must be at least 6 characters.',
    'auth/password-does-not-meet-requirements': 'That password does not meet the password policy.',
    'auth/network-request-failed':   'Cannot reach the login service. Check the connection.',
    'auth/operation-not-allowed':    'Email/password sign-in is not enabled in the Firebase project.',
    'permission-denied':             'You do not have permission to do that.',
    'unavailable':                   'The account database is unreachable. Check the connection.'
  };
  function friendly(e){ return (e && MSG[e.code]) || (e && e.message) || String(e); }

  /* {uid,email,profile,allowed,admin} for a signed-in Firebase user. */
  function describe(u){
    return userRef(u.uid).get().then(function(snap){
      var p = snap.exists ? snap.data() : null;
      var allowed = !!(p && p.active === true);
      return { uid: u.uid, email: u.email, profile: p, allowed: allowed, admin: allowed && p.role === 'admin' };
    });
  }

  /* Whoever is already signed in on this device, or null. */
  function session(){
    return boot().then(function(){
      return new Promise(function(res){
        var off = auth.onAuthStateChanged(function(u){ off(); res(u); });
      });
    }).then(function(u){ return u ? describe(u) : null; });
  }

  function signIn(email, pass){
    return boot()
      .then(function(){ return auth.signInWithEmailAndPassword(String(email).trim(), pass); })
      .then(function(c){ return describe(c.user); });
  }

  function signOut(){ return boot().then(function(){ return auth.signOut(); }); }

  /* The reset email's "continue" button leads back to the dashboard. If that
     domain has not been authorised in Firebase yet, send the plain email.   */
  function sendReset(email){
    email = String(email).trim();
    var back = { url: location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html' };
    return boot().then(function(){
      return auth.sendPasswordResetEmail(email, back).catch(function(e){
        if (/continue-uri|unauthorized-domain|invalid-continue/i.test(e.code || '')) return auth.sendPasswordResetEmail(email);
        throw e;
      });
    });
  }

  /* ---- first run: the first account becomes the administrator, once ---- */
  function ownerExists(){
    return boot().then(function(){ return db.collection('meta').doc('owner').get(); })
                 .then(function(s){ return s.exists; });
  }

  function createOwner(name, email, pass){
    email = String(email).trim();
    var fresh = true;
    return boot()
      .then(function(){ return auth.createUserWithEmailAndPassword(email, pass); })
      .catch(function(e){          // account made earlier in the Firebase console: claim it instead
        if (e.code !== 'auth/email-already-in-use') throw e;
        fresh = false;
        return auth.signInWithEmailAndPassword(email, pass);
      })
      .then(function(c){
        var b = db.batch();
        b.set(userRef(c.user.uid), { email: c.user.email, name: String(name).trim(), role: 'admin',
                                     active: true, createdAt: stamp(), createdBy: c.user.uid });
        b.set(db.collection('meta').doc('owner'), { claimed: true, at: stamp() });
        return b.commit().then(function(){ return describe(c.user); }, function(e){
          // someone else finished setup first - do not leave a stray account behind
          var undo = fresh ? c.user.delete() : auth.signOut();
          return undo.catch(function(){}).then(function(){
            throw e.code === 'permission-denied'
              ? new Error('Setup has already been completed. Sign in, or ask the administrator for an account.')
              : e;
          });
        });
      });
  }

  /* ---- administration ---- */

  /* A second Firebase app creates accounts, so the admin stays signed in. */
  function creatorAuth(){
    if (!creator){
      creator = firebase.initializeApp(FIREBASE_CONFIG, 'operon-user-creator').auth();
      if (emu) creator.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    }
    return creator.setPersistence(firebase.auth.Auth.Persistence.NONE).then(function(){ return creator; });
  }

  function randomPassword(){
    var a = new Uint8Array(18); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(x){ return ('0' + x.toString(16)).slice(-2); }).join('') + 'Aa1!';
  }

  /* o = {name, email, role, password?}. With no password the person is
     emailed a link to choose their own, so no one has to pass one around. */
  function createUser(o){
    var email = String(o.email).trim(), invite = !o.password;
    var me = auth.currentUser;
    return boot().then(creatorAuth).then(function(ca){
      return ca.createUserWithEmailAndPassword(email, o.password || randomPassword()).then(function(c){
        var nu = c.user;
        return userRef(nu.uid).set({ email: nu.email, name: String(o.name || '').trim(), role: o.role === 'admin' ? 'admin' : 'viewer',
                                     active: true, createdAt: stamp(), createdBy: me.uid })
          .catch(function(e){ return nu.delete().catch(function(){}).then(function(){ throw e; }); })
          .then(function(){ return ca.signOut(); })
          .then(function(){ return invite ? sendReset(nu.email) : null; })
          .then(function(){ return { uid: nu.uid, email: nu.email, invited: invite }; });
      });
    });
  }

  function listUsers(){
    return boot().then(function(){ return db.collection('users').get(); }).then(function(q){
      return q.docs.map(function(d){ var v = d.data(); v.uid = d.id; return v; })
                   .sort(function(a, b){ return String(a.email).localeCompare(String(b.email)); });
    });
  }

  /* patch may hold name, role, active */
  function updateUser(uid, patch){
    var clean = { updatedAt: stamp(), updatedBy: auth.currentUser.uid };
    ['name', 'role', 'active'].forEach(function(k){ if (k in patch) clean[k] = patch[k]; });
    return boot().then(function(){ return userRef(uid).update(clean); });
  }

  /* Calls back whenever this person's access changes, e.g. an admin disables them. */
  function watchProfile(uid, cb){
    return userRef(uid).onSnapshot(function(s){ cb(s.exists ? s.data() : null); },
                                   function(){ cb(null); });
  }

  /* ---- the 3PhTech platform login, shared with every active user ---- */
  function loadPlatform(){
    return boot().then(function(){ return db.collection('settings').doc('platform').get(); })
      .then(function(s){ return s.exists ? s.data() : null; })
      .catch(function(){ return null; });
  }
  function savePlatform(email, pass){
    return boot().then(function(){
      return db.collection('settings').doc('platform')
               .set({ email: email, pass: pass, updatedAt: stamp(), updatedBy: auth.currentUser.uid });
    });
  }

  window.WMAuth = {
    enabled: !!FIREBASE_CONFIG,
    emulator: emu,
    session: session, signIn: signIn, signOut: signOut, sendReset: sendReset,
    ownerExists: ownerExists, createOwner: createOwner,
    createUser: createUser, listUsers: listUsers, updateUser: updateUser, watchProfile: watchProfile,
    loadPlatform: loadPlatform, savePlatform: savePlatform,
    friendly: friendly
  };
})();
