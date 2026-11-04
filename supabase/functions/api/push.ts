// Phone notifications through Firebase Cloud Messaging (HTTP v1). Needs a Firebase service account in the FCM_SERVICE_ACCOUNT_JSON secret.
// Uses only standard web APIs (fetch, WebCrypto), so it runs unchanged in Supabase Edge Functions and in the tests.
import type { PushSender } from './lib.ts';

interface ServiceAccount { client_email: string; private_key: string; project_id: string; token_uri?: string }
export interface FcmOptions { serviceAccountJson: string; fetchFn?: typeof fetch; now?: () => number; concurrency?: number; deadlineMs?: number }

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const pemToDer = (pem: string) => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
};

export function createFcmSender(o: FcmOptions): PushSender {
  const account = JSON.parse(o.serviceAccountJson) as ServiceAccount;
  if (!account.client_email || !account.private_key || !account.project_id) throw new Error('FCM service account JSON is missing fields');
  const doFetch = o.fetchFn ?? fetch; const now = o.now ?? (() => Date.now());
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  let cached: { token: string; expires: number } | null = null;
  let key: CryptoKey | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expires - 60_000 > now()) return cached.token;
    key ??= await crypto.subtle.importKey('pkcs8', pemToDer(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat, exp: iat + 3600 }))}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const res = await doFetch(tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }) });
    if (!res.ok) throw new Error(`FCM sign-in failed (${res.status})`);
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('FCM sign-in returned no token');
    cached = { token: json.access_token, expires: now() + (json.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  return {
    configured: true,
    async send(tokens, message) {
      const result = { sent: 0, failed: 0, invalid: [] as string[] };
      if (!tokens.length) return result;
      const bearer = await accessToken();
      const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
      const deadline = now() + (o.deadlineMs ?? 100_000);
      let next = 0;
      async function worker() {
        while (next < tokens.length) {
          const token = tokens[next++];
          if (now() > deadline) { result.failed++; continue; }   // out of time: counted as not sent, never silently dropped
          try {
            const res = await doFetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: {
              token, notification: { title: message.title, body: message.body }, data: message.data ?? {},
              android: { priority: 'HIGH', notification: { channel_id: 'offers', sound: 'default' } } } }) });
            if (res.ok) result.sent++;
            else {
              result.failed++;
              const text = await res.text().catch(() => '');
              if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text) || (res.status === 400 && /INVALID_ARGUMENT/i.test(text) && /token/i.test(text))) result.invalid.push(token);
            }
          } catch { result.failed++; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 10, tokens.length) }, worker));
      return result;
    },
  };
}
