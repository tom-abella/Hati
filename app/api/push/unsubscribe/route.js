import { authenticatedPushClient } from '@/lib/push-server';

export async function POST(request) {
  const auth = await authenticatedPushClient(request);
  if (!auth) return Response.json({ error: 'Sign in required.' }, { status: 401 });
  let input;
  try { input = await request.json(); } catch { return Response.json({ error: 'Invalid endpoint.' }, { status: 400 }); }
  if (typeof input?.endpoint !== 'string' || input.endpoint.length > 4096) return Response.json({ error: 'Invalid endpoint.' }, { status: 400 });
  const { error } = await auth.db.from('push_subscriptions').delete().eq('user_id', auth.user.id).eq('endpoint', input.endpoint);
  if (error) return Response.json({ error: 'Could not remove subscription.' }, { status: 500 });
  return Response.json({ ok: true });
}
