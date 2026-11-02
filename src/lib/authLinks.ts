// Parsing and explaining the links Supabase sends by email (password reset, email confirmation).
// Pure functions with no React or Expo imports, so they can be tested on their own.

export interface AuthLink {
  /** Path inside the app, without slashes at the ends, e.g. "reset-password". */
  path: string;
  code?: string;
  errorCode?: string;
  errorDescription?: string;
  /** True when Supabase reports a problem with the link (expired, already used, denied). */
  hasError: boolean;
  isRecovery: boolean;
}

const decode = (v: string) => { try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return v; } };
function pairs(part: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of part.split('&')) { if (!item) continue; const i = item.indexOf('='); out[decode(i < 0 ? item : item.slice(0, i))] = i < 0 ? '' : decode(item.slice(i + 1)); }
  return out;
}

/** Works for `bunkin://reset-password?code=…`, `bunkin:///reset-password?...#error=…` and https links. */
export function parseAuthLink(url: string): AuthLink {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? '' : beforeHash.slice(queryAt + 1);
  const p = { ...pairs(query), ...pairs(hash) };
  const afterScheme = base.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '');
  const path = afterScheme.split('/').filter(Boolean).filter((s, i, all) => !(i === 0 && all.length > 1 && /^[\w.-]+:\d+$/.test(s))).join('/');
  const errorCode = p.error_code || undefined;
  const errorDescription = p.error_description || undefined;
  const hasError = !!(p.error || errorCode || errorDescription);
  return {
    path, code: p.code || undefined, errorCode, errorDescription, hasError,
    isRecovery: /(^|\/)reset-password$/.test(path) || p.type === 'recovery',
  };
}

/** Plain-language text for a failed link or a failed code exchange. */
export function authLinkProblem(errorCode?: string, description?: string): string {
  const text = `${errorCode ?? ''} ${description ?? ''}`.toLowerCase();
  if (text.includes('otp_expired') || text.includes('expired')) return 'This link has expired. Request a new reset link and open it soon after it arrives.';
  if (text.includes('code verifier') || text.includes('flow state') || text.includes('pkce')) return 'This link has to be opened on the same phone where you asked for it. Please request a new link here.';
  if (text.includes('access_denied') || text.includes('invalid') || text.includes('already') || text.includes('used')) return 'This link is not valid or has already been used. Request a new reset link.';
  return description ? `We could not use this link: ${description}` : 'We could not use this link. Please request a new one.';
}

export const MIN_PASSWORD = 8;
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD) return `Choose a password with at least ${MIN_PASSWORD} characters.`;
  if (password !== confirmation) return 'The two passwords do not match.';
  return null;
}
