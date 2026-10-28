// Reference implementation of the owner-only staff endpoints (Deno / Supabase Edge Functions).
//   GET   /owner/staff            list managers and riders
//   POST  /owner/staff            create a manager or rider, returns a one-time temporary password
//   PATCH /owner/staff/:id        { active?: boolean, resetPassword?: boolean }
//   POST  /me/password-changed    clears must_change_password for the caller
// If your API (the "Part 2" backend) is separate, port these handlers there. The rules are what matter.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
const fail = (message: string, status: number) => json({ message }, status);

type Caller = { id: string; role: 'customer' | 'owner' | 'manager' | 'rider'; active: boolean; name: string; email: string; phone: string; must_change_password: boolean };

async function caller(req: Request): Promise<Caller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await admin.from('profiles').select('id, role, active, name, email, phone, must_change_password').eq('id', data.user.id).single();
  return profile && profile.active ? (profile as Caller) : null;
}

function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '-7';
}
const member = (p: Record<string, unknown>) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, active: p.active, mustChangePassword: p.must_change_password });
const emailOk = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const path = new URL(req.url).pathname.replace(/^\/(functions\/v1\/)?staff/, '').replace(/\/$/, '');
  const me = await caller(req);
  if (!me) return fail('Please sign in to continue.', 401);

  if (req.method === 'POST' && path === '/me/password-changed') {
    const { data, error } = await admin.from('profiles').update({ must_change_password: false }).eq('id', me.id).select().single();
    if (error) return fail('Could not update your account.', 500);
    return json({ ...member(data), role: data.role });
  }

  if (me.role !== 'owner') return fail('Only the restaurant owner can manage team accounts.', 403);

  if (req.method === 'GET' && path === '/owner/staff') {
    const { data, error } = await admin.from('profiles').select('*').in('role', ['manager', 'rider']).order('created_at', { ascending: false });
    if (error) return fail('Could not load the team.', 500);
    return json(data.map(member));
  }

  if (req.method === 'POST' && path === '/owner/staff') {
    const body = await req.json().catch(() => null);
    const name = String(body?.name ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const phone = String(body?.phone ?? '').trim();
    if (!['manager', 'rider'].includes(body?.role)) return fail('Role must be manager or rider.', 400);
    if (name.length < 2 || name.length > 80) return fail('Enter the team member’s name.', 400);
    if (!emailOk(email)) return fail('Enter a valid email address.', 400);
    if (!/^[+]?[0-9\s-]{10,15}$/.test(phone)) return fail('Enter a valid mobile number.', 400);
    const password = temporaryPassword();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: body.role }, user_metadata: { name } });
    if (created.error || !created.data.user) return fail(/already|registered|exists/i.test(created.error?.message ?? '') ? 'An account with this email already exists.' : 'Could not create the account.', created.error ? 409 : 500);
    const { data, error } = await admin.from('profiles').update({ phone, name }).eq('id', created.data.user.id).select().single();
    if (error) return fail('The account was created but its profile could not be completed. Reset its password to retry.', 500);
    return json({ member: member(data), temporaryPassword: password }, 201);
  }

  const match = path.match(/^\/owner\/staff\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && match) {
    const id = match[1];
    const { data: target } = await admin.from('profiles').select('*').eq('id', id).single();
    if (!target || !['manager', 'rider'].includes(target.role)) return fail('Team member not found.', 404);
    const body = await req.json().catch(() => ({}));
    let password: string | undefined;
    if (typeof body.active === 'boolean') {
      const result = await admin.auth.admin.updateUserById(id, { ban_duration: body.active ? 'none' : '876000h' });
      if (result.error) return fail('Could not change this account.', 500);
      await admin.from('profiles').update({ active: body.active }).eq('id', id);
    }
    if (body.resetPassword === true) {
      password = temporaryPassword();
      const result = await admin.auth.admin.updateUserById(id, { password });
      if (result.error) return fail('Could not reset the password.', 500);
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
    }
    const { data } = await admin.from('profiles').select('*').eq('id', id).single();
    return json({ member: member(data!), temporaryPassword: password });
  }

  return fail('Not found.', 404);
});
