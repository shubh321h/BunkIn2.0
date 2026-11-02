import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/** Must match `expo.scheme` in app.json. */
export const APP_SCHEME = 'bunkin';

/**
 * Where Supabase sends people after they tap an email link.
 *  - Installed Android app: `bunkin://<path>` (opens the app through its URL scheme).
 *  - Web build: the site's own address.
 * Never localhost. Supabase must have this address in Authentication > URL Configuration > Redirect URLs.
 */
export function emailRedirect(path: 'reset-password' | 'account'): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/${path}`;
  return Linking.createURL(path, { scheme: APP_SCHEME });
}
