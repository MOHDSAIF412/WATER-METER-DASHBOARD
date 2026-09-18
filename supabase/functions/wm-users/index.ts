// OPERON water dashboard - adds and removes dashboard accounts.
// Runs on Supabase, never in the browser, because creating an account needs
// the service key. Only a signed-in administrator of THIS dashboard may call
// it: every request's token is checked, then the caller's row in wm_profiles.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function madeUpPassword(){
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12) + 'A9!';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply({ error: 'Sign in first.' }, 401);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return reply({ error: 'Your session has expired. Sign in again.' }, 401);

  const { data: me } = await admin.from('wm_profiles')
    .select('role, active').eq('id', who.user.id).maybeSingle();
  if (!me?.active || me.role !== 'admin')
    return reply({ error: 'Only an administrator can manage users.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const action = String(body.action || '');

  if (action === 'create'){
    const email = String(body.email || '').trim().toLowerCase();
    const name  = String(body.name || '').trim();
    const role  = body.role === 'admin' ? 'admin' : 'viewer';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'Enter a valid email address.' }, 400);

    const given = typeof body.password === 'string' && body.password.length >= 8 ? body.password : null;
    const password = given || madeUpPassword();

    const { data: made, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error) return reply({ error: /already/i.test(error.message) ? 'An account with this email already exists.' : error.message }, 400);

    const { error: pErr } = await admin.from('wm_profiles').insert({
      id: made.user.id, email, name, role, active: true, created_by: who.user.id,
    });
    if (pErr){                                   // leave no half-made account behind
      await admin.auth.admin.deleteUser(made.user.id);
      return reply({ error: pErr.message }, 400);
    }
    return reply({ id: made.user.id, email, password: given ? null : password });
  }

  if (action === 'password'){                     // give someone a new password
    const id = String(body.id || '');
    const password = typeof body.password === 'string' && body.password.length >= 8 ? body.password : madeUpPassword();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return reply({ error: error.message }, 400);
    return reply({ id, password });
  }

  if (action === 'remove'){
    const id = String(body.id || '');
    if (id === who.user.id) return reply({ error: 'You cannot remove your own account.' }, 400);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return reply({ error: error.message }, 400);
    return reply({ id, removed: true });
  }

  return reply({ error: 'Unknown action.' }, 400);
});
