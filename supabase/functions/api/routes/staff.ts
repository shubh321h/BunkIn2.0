// Owner-issued sign-ins for managers and riders, and the forced first-login password change.
import { HttpError, Row, bad, bool, num, obj, phone, str, temporaryPassword, uuid, EMAIL } from '../lib.ts';
import type { Ctx, Router } from '../handler.ts';

const memberJson = (p: Row) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, active: p.active, mustChangePassword: p.must_change_password });

/** Remember the temporary password's fingerprint so we can tell later that it was replaced. */
async function rememberTemporary(c: Ctx, userId: string) {
  await c.sql`insert into private.staff_temp_passwords (user_id, password_hash)
    select id, coalesce(encrypted_password, '') from auth.users where id = ${userId}::uuid
    on conflict (user_id) do update set password_hash = excluded.password_hash, issued_at = now()`;
}

export function staffRoutes(r: Router) {
  r.add('POST', '/me/password-changed', 'user', async (c) => {
    const me = c.me();
    if (me.mustChangePassword) {
      const [changed] = await c.sql`select exists (
        select 1 from private.staff_temp_passwords t join auth.users u on u.id = t.user_id
        where t.user_id = ${me.id}::uuid and coalesce(u.encrypted_password, '') <> t.password_hash) as ok`;
      if (!changed.ok) throw new HttpError(400, 'Please choose a new password first. The temporary password is still in use.', 'PASSWORD_NOT_CHANGED');
    }
    const [p] = await c.sql`update public.profiles set must_change_password = false where id = ${me.id}::uuid
      returning id, name, email, phone, role::text as role, must_change_password`;
    await c.sql`delete from private.staff_temp_passwords where user_id = ${me.id}::uuid`;
    return { id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, mustChangePassword: p.must_change_password };
  });

  r.add('GET', '/owner/staff', ['owner'], async (c) => {
    const rows = await c.sql`select id, name, email, phone, role::text as role, active, must_change_password from public.profiles
      where role in ('manager','rider') order by created_at desc`;
    return rows.map(memberJson);
  });

  r.add('POST', '/owner/staff', ['owner'], async (c) => {
    c.limit('staff-create', 20);
    const b = obj(await c.json());
    if (b.role !== 'manager' && b.role !== 'rider') throw bad('Role must be manager or rider.');
    const name = str(b.name, 'Name', { min: 2, max: 80 });
    const email = str(b.email, 'Email', { min: 5, max: 254 }).toLowerCase();
    if (!EMAIL.test(email)) throw bad('Enter a valid email address.');
    const ph = phone(b.phone);
    const password = temporaryPassword();
    const created = await c.auth.admin.createUser({ email, password, role: b.role, name });
    if ('error' in created) throw new HttpError(created.error === 'exists' ? 409 : 502, created.error === 'exists' ? 'An account with this email already exists.' : 'Could not create the account. Please try again.', 'ACCOUNT_CREATE_FAILED');
    const [p] = await c.sql`update public.profiles set phone = ${ph}, name = ${name} where id = ${created.id}::uuid
      returning id, name, email, phone, role::text as role, active, must_change_password`;
    if (!p) throw new HttpError(500, 'The account was created but could not be completed. Reset its password to retry.', 'SERVER_ERROR');
    await rememberTemporary(c, created.id);
    await c.sql`insert into public.audit_log (actor_id, action, entity, entity_id, details) values (${c.me().id}::uuid, 'staff.create', 'profile', ${created.id}, ${JSON.stringify({ role: b.role })}::text::jsonb)`;
    return c.reply({ member: memberJson(p), temporaryPassword: password }, 201);
  });

  r.add('PATCH', '/owner/staff/:id', ['owner'], async (c) => {
    const id = uuid(c.params.id); const b = obj(await c.json());
    const [target] = await c.sql`select id, role::text as role from public.profiles where id = ${id}::uuid`;
    if (!target || (target.role !== 'manager' && target.role !== 'rider')) throw new HttpError(404, 'Team member not found.', 'NOT_FOUND');
    let password: string | undefined;
    if (b.active !== undefined) {
      const active = bool(b.active, 'Active');
      if (!(await c.auth.admin.setBanned(id, !active))) throw new HttpError(502, 'Could not change this account. Please try again.', 'ACCOUNT_UPDATE_FAILED');
      await c.sql`update public.profiles set active = ${active} where id = ${id}::uuid`;
    }
    if (b.resetPassword === true) {
      password = temporaryPassword();
      if (!(await c.auth.admin.setPassword(id, password))) throw new HttpError(502, 'Could not reset the password. Please try again.', 'ACCOUNT_UPDATE_FAILED');
      await c.sql`update public.profiles set must_change_password = true where id = ${id}::uuid`;
      await rememberTemporary(c, id);
    }
    await c.sql`insert into public.audit_log (actor_id, action, entity, entity_id, details) values (${c.me().id}::uuid, 'staff.update', 'profile', ${id}, ${JSON.stringify({ active: b.active, reset: b.resetPassword === true })}::text::jsonb)`;
    const [p] = await c.sql`select id, name, email, phone, role::text as role, active, must_change_password from public.profiles where id = ${id}::uuid`;
    return { member: memberJson(p), ...(password ? { temporaryPassword: password } : {}) };
  });
}
void num;
