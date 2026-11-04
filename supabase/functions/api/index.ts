// Supabase Edge Function entry point. Everything interesting lives in handler.ts so it can be tested anywhere.
// Secrets this function reads (Supabase injects the first three automatically):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
//   APP_PUBLISHABLE_KEY        (optional; used to verify sign-in tokens. Falls back to SUPABASE_ANON_KEY)
//   APP_SECRET_KEY, APP_DB_URL (optional fallbacks if Supabase does not inject the secret key / database URL in your project)
//   ALLOWED_ORIGIN             (optional; the website address allowed to call this API. Defaults to any, which is fine for the mobile app)
import { createClient } from '@supabase/supabase-js';
import { createApi } from './handler.ts';
import { makeDb } from './db.ts';
import { createFcmSender } from './push.ts';
import type { AuthPort, PushSender, StoragePort } from './lib.ts';

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

// Double-checks the PIN code at a map position with an OpenStreetMap geocoder (Nominatim-compatible). Light use only:
// one lookup per saved address or order. For heavy traffic point GEOCODER_REVERSE_URL at your own or a paid provider.
const reverseUrl = env('GEOCODER_REVERSE_URL') ?? 'https://nominatim.openstreetmap.org/reverse';
const userAgent = env('GEOCODER_USER_AGENT') ?? 'BunkInDelivery/1.0 (service-area check)';
async function reverseGeocode(lat: number, lng: number) {
  const url = `${reverseUrl}?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const data = await res.json();
  return { postcode: typeof data?.address?.postcode === 'string' ? data.address.postcode : undefined };
}

// Dish photos go to the public "dish-images" bucket (created by the database migration). Only this function can write to it.
const storage: StoragePort = {
  async upload(path, bytes, contentType) {
    const { error } = await admin.storage.from('dish-images').upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
    if (error) { console.error(JSON.stringify({ level: 'error', event: 'storage_upload', message: error.message.slice(0, 160) })); return null; }
    return admin.storage.from('dish-images').getPublicUrl(path).data.publicUrl;
  },
};
// Phone notifications need a Firebase service account (secret FCM_SERVICE_ACCOUNT_JSON). Without it offers still reach the in-app inbox.
let push: PushSender | undefined;
const fcmJson = env('FCM_SERVICE_ACCOUNT_JSON');
if (fcmJson) { try { push = createFcmSender({ serviceAccountJson: fcmJson }); } catch (e) { console.error(JSON.stringify({ level: 'error', event: 'fcm_config', message: String((e as Error).message).slice(0, 160) })); } }

const handle = createApi({ sql, auth, storage, env: { allowedOrigin: env('ALLOWED_ORIGIN'), onlinePayments: false, reverseGeocode, push } });
Deno.serve(handle);
