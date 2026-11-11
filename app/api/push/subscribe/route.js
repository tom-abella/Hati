import { authenticatedPushClient } from '@/lib/push-server';

export async function POST(request) {
  const auth = await authenticatedPushClient(request);
  if (!auth) return Response.json({ error: 'Sign in required.' }, { status: 401 });
  let input;
  try { input = await request.json(); } catch { return Response.json({ error: 'Invalid subscription.' }, { status: 400 }); }
  const { endpoint, keys } = input || {};
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || !URL.canParse(endpoint) || new URL(endpoint).protocol !== 'https:' || typeof keys?.p256dh !== 'string' || !keys.p256dh || keys.p256dh.length > 256 || typeof keys?.auth !== 'string' || !keys.auth || keys.auth.length > 256) return Response.json({ error: 'Invalid subscription.' }, { status: 400 });
  const host = new URL(endpoint).hostname;
  if (new URL(endpoint).port || (host !== 'fcm.googleapis.com' && host !== 'updates.push.services.mozilla.com' && !host.endsWith('.push.apple.com') && host !== 'push.apple.com' && !host.endsWith('.notify.windows.com'))) return Response.json({ error: 'Unsupported push service.' }, { status: 400 });
  const { error } = await auth.db.from('push_subscriptions').upsert({ user_id: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });
  if (error) return Response.json({ error: 'Could not save subscription.' }, { status: 500 });
  return Response.json({ ok: true });
}
