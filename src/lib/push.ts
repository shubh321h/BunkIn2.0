// Phone notifications for offers. Works only on a real Android/iOS build; on the web it quietly does nothing.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

export const OFFERS_CHANNEL = 'offers';
const supported = Platform.OS === 'android' || Platform.OS === 'ios';

/** Show notifications that arrive while the app is open. Call once at start-up. */
export function configureNotifications() {
  if (!supported) return;
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
}

async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(OFFERS_CHANNEL, { name: 'Offers and updates', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 100, 200] });
}
const deviceToken = async () => { const t = await Notifications.getDevicePushTokenAsync(); return typeof t.data === 'string' ? t.data : ''; };
const notSetUp = (e: unknown) => /firebase|fcm|google-services|not initialized|SERVICE_NOT_AVAILABLE/i.test(String((e as Error)?.message ?? e));

export interface PushResult { ok: boolean; message?: string }

/** Ask permission (if needed), get this phone's address for notifications, and tell the server. */
export async function enablePush(): Promise<PushResult> {
  if (!supported) return { ok: false, message: 'Phone notifications work in the Android app. You will still see offers inside the app.' };
  try {
    await ensureChannel();
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return { ok: false, message: 'Notifications are turned off for BunkIn. Allow them in your phone settings to get offers. You will still see offers inside the app.' };
    const token = await deviceToken();
    if (token.length < 20) return { ok: false, message: 'This phone could not be registered for notifications right now. You will still see offers inside the app.' };
    await api.registerPushToken(token, Platform.OS);
    return { ok: true };
  } catch (e) {
    if (notSetUp(e)) return { ok: false, message: 'Phone notifications are not switched on in this version of the app yet. You will still see offers inside the app.' };
    return { ok: false, message: 'Could not turn on phone notifications. Please try again.' };
  }
}

/** Forget this phone on the server (offers turned off, or signing out). Never throws. */
export async function disablePush(): Promise<void> {
  if (!supported) return;
  try { const token = await deviceToken(); if (token) await api.removePushToken(token); } catch { /* nothing to forget */ }
}

/** After sign-in: if permission was already granted, keep the server's copy of this phone's address current (it can change). Never prompts. */
export async function refreshPushToken(): Promise<void> {
  if (!supported) return;
  try {
    const permission = await Notifications.getPermissionsAsync(); if (permission.status !== 'granted') return;
    await ensureChannel();
    const token = await deviceToken(); if (token.length >= 20) await api.registerPushToken(token, Platform.OS);
  } catch { /* push is optional */ }
}
