// Checking an uploaded photo before it is stored. The file's own first bytes decide what it is, not the name or the type the phone claims.
export type ImageKind = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };
export const MAX_IMAGE_BYTES = 1_572_864; // 1.5 MB, matching the storage bucket limit

export function detectImage(b: Uint8Array): ImageKind | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Decodes standard base64 (with or without a "data:image/...;base64," prefix). Returns null for anything that is not clean base64. */
export function decodeBase64(text: string): Uint8Array | null {
  const raw = text.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
  if (!raw || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return null;
  try {
    const bin = atob(raw); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
