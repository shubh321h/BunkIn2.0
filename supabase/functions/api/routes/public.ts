// Supabase Edge Function entry point. Everything interesting lives in handler.ts so it can be tested anywhere.
// Secrets this function reads (Supabase injects the first three automatically):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
//   APP_PUBLISHABLE_KEY        (optional; used to verify sign-in tokens. Falls back to SUPABASE_ANON_KEY)
//   APP_SECRET_KEY, APP_DB_URL (optional fallbacks if Supabase does not inject the secret key / database URL in your project)
//   ALLOWED_ORIGIN             (optional; the website address allowed to call this API. Defaults to any, which is fine for the mobile app)
import { createClient } from '@supabase/supabase-js';
import { createApi } from './handler.ts';
import { makeDb } from './db.ts';
import type { AuthPort } from './lib.ts';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void };
const env = (name: string) => Deno.env.get(name);
const url = env('SUPABASE_URL'); if (!url) throw new Error('Missing secret SUPABASE_URL');
const either = (a: string, b: string) => { const v = env(a) ?? env(b); if (!v) throw new Error(`Missing secret ${a} (or ${b})`); return v; };
const sql = makeDb(either('SUPABASE_DB_URL', 'APP_DB_URL'));
const serviceKey = either('SUPABASE_SERVICE_ROLE_KEY', 'APP_SECRET_KEY');
const verifyKey = env('APP_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY') ?? serviceKey;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const verifier = createClient(url, verifyKey, noSession);
const admin = createClient(url, serviceKey, noSession);

const auth: AuthPort = {
  async verify(token) { const { data, error } = await verifier.auth.getUser(token); return error || !data.user ? null : data.user.id; },
  admin: {
    async createUser({ email, password, role, name }) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role }, user_metadata: { name } });
      if (error || !data.user) return { error: /already|registered|exists/i.test(error?.message ?? '') ? 'exists' : 'failed' };
      return { id: data.user.id };
    },
    async setBanned(id, banned) { const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banned ? '876000h' : 'none' }); return !error; },
    async setPassword(id, password) { const { error } = await admin.auth.admin.updateUserById(id, { password }); return !error; },
  },
};

const handle = createApi({ sql, auth, env: { allowedOrigin: env('ALLOWED_ORIGIN'), onlinePayments: false } });
Deno.serve(handle);
