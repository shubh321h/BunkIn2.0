// One-time setup: creates the single pre-registered owner account.
// Run on YOUR machine, never ship or commit the service-role key:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OWNER_EMAIL=... OWNER_NAME=... OWNER_PASSWORD=... node scripts/seed-owner.mjs
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OWNER_EMAIL || !OWNER_NAME || !OWNER_PASSWORD) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD.');
  process.exit(1);
}
if (OWNER_PASSWORD.length < 12) { console.error('Use an owner password of at least 12 characters.'); process.exit(1); }

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: existing, error: lookupError } = await admin.from('profiles').select('id').eq('role', 'owner').limit(1);
if (lookupError) { console.error('Could not check for an existing owner:', lookupError.message); process.exit(1); }
if (existing?.length) { console.error('An owner already exists. This restaurant has exactly one owner.'); process.exit(1); }

const { data, error } = await admin.auth.admin.createUser({
  email: OWNER_EMAIL.trim().toLowerCase(), password: OWNER_PASSWORD, email_confirm: true,
  app_metadata: { role: 'owner' }, user_metadata: { name: OWNER_NAME },
});
if (error) { console.error('Could not create the owner:', error.message); process.exit(1); }
console.log('Owner created:', data.user.email, '. They will be asked to choose a new password on first sign-in.');
