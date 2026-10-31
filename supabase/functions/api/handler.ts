// The BunkIn API: authentication, routing, rate limits and error handling. Business rules live in the database.
import { AuthPort, Db, Env, HttpError, Role, Row, bad, corsHeaders, fromDbError, respond } from './lib.ts';
import { publicRoutes } from './routes/public.ts';
import { customerRoutes } from './routes/customer.ts';
import { kitchenRoutes } from './routes/kitchen.ts';
import { ownerRoutes } from './routes/owner.ts';
import { riderRoutes } from './routes/rider.ts';
import { staffRoutes } from './routes/staff.ts';

export interface User { id: string; role: Role; name: string; email: string; phone: string; mustChangePassword: boolean }
export interface Ctx {
  sql: Db; auth: AuthPort; env: Env; req: Request; url: URL; params: Record<string, string>;
  user: User | null; requestId: string;
  /** The signed-in user (routes that need one are guarded, so this never throws for them). */
  me(): User;
  json(): Promise<Row>;
  reply(data: unknown, status?: number): Response;
  /** Per-user (or per-IP) limit for expensive actions. Throws 429 when exceeded. */
  limit(name: string, max: number): void;
}
/** public: no sign-in. optional: works signed out, richer when staff are signed in. user: any active account. Role list: only those roles. */
export type Access = 'public' | 'optional' | 'user' | Role[];
export type Handler = (c: Ctx) => Promise<unknown>;
export interface Router { add(method: string, path: string, access: Access, run: Handler): void }

interface Route { method: string; re: RegExp; keys: string[]; access: Access; run: Handler }
const MAX_BODY = 64 * 1024;
const ALLOWED_WHILE_PASSWORD_UNCHANGED = new Set(['GET /me', 'POST /me/password-changed']);

export function createApi(deps: { sql: Db; auth: AuthPort; env?: Env }) {
  const { sql, auth } = deps; const env = deps.env ?? {};
  const routes: Route[] = [];
  const router: Router = {
    add(method, path, access, run) {
      const keys: string[] = [];
      const re = new RegExp('^' + path.replace(/:[a-z]+/gi, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
      routes.push({ method, re, keys, access, run });
    },
  };
  for (const register of [publicRoutes, customerRoutes, kitchenRoutes, ownerRoutes, riderRoutes, staffRoutes]) register(router);

  const hits = new Map<string, { n: number; reset: number }>();
  function limited(key: string, max: number, windowMs = 60_000): boolean {
    const now = Date.now(); let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }
    h.n += 1; return h.n > max;
  }

  async function authenticate(req: Request): Promise<User | null> {
    const header = req.headers.get('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return null;
    let id: string | null = null;
    try { id = await auth.verify(m[1]); } catch { id = null; }
    if (!id) return null;
    const rows = await sql`select id, role::text as role, name, email, phone, must_change_password, active from public.profiles where id = ${id}::uuid`;
    const p = rows[0];
    if (!p) return null;
    if (!p.active) throw new HttpError(403, 'This account is disabled. Please contact the restaurant.', 'ACCOUNT_DISABLED');
    return { id: p.id, role: p.role, name: p.name, email: p.email, phone: p.phone, mustChangePassword: p.must_change_password };
  }

  return async function handle(req: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    let status = 500; let label = '';
    try {
      if (req.method === 'OPTIONS') { status = 204; return new Response(null, { status: 204, headers: corsHeaders(env) }); }
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/(functions\/v1\/)?api(?=\/|$)/, '').replace(/\/+$/, '') || '/';
      const route = routes.map((r) => ({ r, m: r.method === req.method ? r.re.exec(path) : null })).find((x) => x.m);
      if (!route || !route.m) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
      const { r, m } = route; label = `${req.method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

      const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
      const cap = env.rateLimitPerMinute ?? 300;
      if (r.access === 'public' || r.access === 'optional') { if (limited('ip:' + ip, cap)) throw new HttpError(429, 'Too many requests. Please slow down.', 'RATE_LIMITED'); }

      let user: User | null = null;
      if (r.access !== 'public') {
        user = r.access === 'optional' ? await authenticate(req).catch(() => null) : await authenticate(req);
        if (r.access !== 'optional') {
          if (!user) throw new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');
          if (limited('u:' + user.id, cap)) throw new HttpError(429, 'Too many requests. Please slow down.', 'RATE_LIMITED');
          if (user.mustChangePassword && !ALLOWED_WHILE_PASSWORD_UNCHANGED.has(`${req.method} ${path}`)) {
            throw new HttpError(403, 'Please choose your own password first.', 'PASSWORD_CHANGE_REQUIRED');
          }
          if (Array.isArray(r.access) && !r.access.includes(user.role)) throw new HttpError(403, 'Your role cannot do this.', 'FORBIDDEN');
        }
      }

      const ctx: Ctx = {
        sql, auth, env, req, url, params, user, requestId,
        me() { if (!user) throw new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'); return user; },
        async json() {
          const text = await req.text();
          if (text.length > MAX_BODY) throw new HttpError(413, 'That request is too large.', 'TOO_LARGE');
          if (!text.trim()) return {};
          try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v as Row; }
          catch { throw bad('The request could not be read.'); }
        },
        reply: (data, s = 200) => respond(env, data, s),
        limit(name, max) { if (limited(`${name}:${user?.id ?? ip}`, max)) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.', 'RATE_LIMITED'); },
      };
      const out = await r.run(ctx);
      const res = out instanceof Response ? out : respond(env, out ?? {}, 200);
      status = res.status;
      const cacheable = r.access !== 'user' && !Array.isArray(r.access) && !user && req.method === 'GET' && res.status === 200 && (path === '/menu' || path === '/restaurant' || path === '/offers');
      if (cacheable) res.headers.set('Cache-Control', 'public, max-age=10');
      res.headers.set('X-Request-Id', requestId);
      return res;
    } catch (e) {
      const err = fromDbError(e, requestId); status = err.status;
      return respond(env, { message: err.message, code: err.code, requestId }, err.status, { 'X-Request-Id': requestId });
    } finally {
      if (label) console.log(JSON.stringify({ requestId, route: label, status, ms: Date.now() - started }));
    }
  };
}
