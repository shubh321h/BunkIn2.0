// Dish photos: owner or manager picks a photo in the app; the API checks it and stores it in public storage.
import { HttpError, Role, bad, str } from '../lib.ts';
import type { Router } from '../handler.ts';
import { MAX_IMAGE_BYTES, decodeBase64, detectImage } from '../images.ts';

const KITCHEN: Role[] = ['owner', 'manager'];

export function uploadRoutes(r: Router) {
  r.add('POST', '/owner/uploads/image', KITCHEN, async (c) => {
    c.limit('image-upload', 30);
    if (!c.storage) throw new HttpError(503, 'Photo upload is not set up yet. You can paste an image link instead.', 'STORAGE_UNAVAILABLE');
    const b = await c.json(Math.ceil(MAX_IMAGE_BYTES * 1.4) + 1024);
    const bytes = decodeBase64(str(b.data, 'Photo', { min: 16, max: Math.ceil(MAX_IMAGE_BYTES * 1.4) }));
    if (!bytes) throw bad('That photo could not be read. Please pick it again.', 'INVALID_IMAGE');
    if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'That photo is too large. Photos can be up to 1.5 MB.', 'IMAGE_TOO_LARGE');
    const kind = detectImage(bytes);
    if (!kind) throw bad('Please choose a JPEG, PNG or WebP photo.', 'INVALID_IMAGE');
    const url = await c.storage.upload(`dishes/${crypto.randomUUID()}.${kind.ext}`, bytes, kind.mime);
    if (!url) throw new HttpError(502, 'The photo could not be saved. Please try again.', 'STORAGE_FAILED');
    await c.sql`insert into public.audit_log (actor_id, action, entity, details) values (${c.me().id}::uuid, 'image.upload', 'storage', ${JSON.stringify({ bytes: bytes.length, type: kind.mime })}::text::jsonb)`;
    return c.reply({ url }, 201);
  });
}
