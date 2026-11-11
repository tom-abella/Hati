import { supabase } from './supabase.js';

function vapidBytes(key) {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function post(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to manage notifications.');
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error || 'Could not update notifications.');
}

export async function subscribeToPush() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('Push notifications are not configured.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(key) });
  await post('/api/push/subscribe', subscription.toJSON());
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
  if (!await subscription.unsubscribe()) throw new Error('Could not disable notifications on this device.');
}
