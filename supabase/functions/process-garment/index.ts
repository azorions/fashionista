/**
 * process-garment: source photo in, finished tile out.
 *
 * Deliberately narrow. This function exists because the cutout provider's API
 * token must not ship in the app bundle -- that is the ONLY reason any of this
 * runs on a server. So it does exactly three things: call the provider,
 * post-process deterministically, and write the results.
 *
 * What it pointedly does NOT do is score the mask or extract the palette, even
 * though the original design put both here. Those live in src/domain, which
 * uses extensionless relative imports that Deno rejects, and the client has to
 * download the tile to display it anyway -- so it scores it there, against the
 * same already-tested code, and no logic gets duplicated across two runtimes.
 *
 * Invoked as: supabase.functions.invoke('process-garment', { body: { imageId } })
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cutout, CutoutError } from './cutout.ts';
import { postprocess } from './postprocess.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * The service key.
 *
 * Projects on Supabase's current key system inject it as SUPABASE_SECRET_KEYS,
 * a JSON dictionary of named keys. SUPABASE_SERVICE_ROLE_KEY is still injected
 * but documented as legacy, and this app's client already uses the new
 * publishable key. Prefer the new variable, fall back to the old one, and fail
 * loudly rather than build a client around an empty string.
 */
function serviceKey(): string {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const key = Object.values(JSON.parse(dict) as Record<string, unknown>).find(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      if (key) return key;
    } catch {
      // Malformed -- fall through to the legacy variable.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('no service key available (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY)');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization' }, 401);

  let admin;
  try {
    // The secret key bypasses RLS, so every query below is explicitly scoped
    // to the verified user id. Never trust a user_id from the request body.
    admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }

  // Verify the caller's JWT with the Auth server. Doing it through the admin
  // client removes any dependency on the legacy SUPABASE_ANON_KEY.
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);

  const user = userData?.user;
  if (!user) return json({ error: 'invalid token' }, 401);

  let imageId: string;
  try {
    ({ imageId } = await req.json());
    if (!imageId) throw new Error();
  } catch {
    return json({ error: 'body must be { imageId }' }, 400);
  }

  const { data: row, error: loadErr } = await admin
    .from('item_images')
    .select('id, item_id, user_id, version, source_path, status')
    .eq('id', imageId)
    .eq('user_id', user.id) // scoping, since the service role skips RLS
    .single();

  if (loadErr || !row) return json({ error: 'image not found' }, 404);
  if (row.status === 'ready') return json({ status: 'ready', alreadyDone: true });

  const dir = `${user.id}/${row.item_id}/v${row.version}`;
  const fail = async (message: string, status = 500) => {
    await admin
      .from('item_images')
      .update({ status: 'failed', error: message.slice(0, 500) })
      .eq('id', row.id);
    return json({ status: 'failed', error: message }, status);
  };

  await admin.from('item_images').update({ status: 'processing' }).eq('id', row.id);

  try {
    // The provider needs a URL it can reach. Short-lived by design.
    const { data: signed, error: signErr } = await admin.storage
      .from('wardrobe')
      .createSignedUrl(row.source_path, 300);
    if (signErr || !signed) return await fail(`could not sign source: ${signErr?.message}`);

    const { png, provider, ms } = await cutout(signed.signedUrl);
    const { tile, thumb } = await postprocess(png);

    const put = (name: string, bytes: Uint8Array) =>
      admin.storage.from('wardrobe').upload(`${dir}/${name}`, bytes, {
        contentType: 'image/webp',
        upsert: true,
      });

    const [tileUp, thumbUp] = await Promise.all([put('tile.webp', tile), put('thumb.webp', thumb)]);
    if (tileUp.error) return await fail(`tile upload: ${tileUp.error.message}`);
    if (thumbUp.error) return await fail(`thumb upload: ${thumbUp.error.message}`);

    const tile_path = `${dir}/tile.webp`;
    const thumb_path = `${dir}/thumb.webp`;

    // status 'ready' means the pixels exist. The client still scores the mask
    // and may show a retake prompt -- that verdict is its call, not ours.
    await admin
      .from('item_images')
      .update({ status: 'ready', tile_path, thumb_path, provider, error: null })
      .eq('id', row.id);

    return json({ status: 'ready', tile_path, thumb_path, provider, ms });
  } catch (e) {
    const msg = e instanceof CutoutError ? `cutout: ${e.message}` : String(e);
    return await fail(msg);
  }
});
