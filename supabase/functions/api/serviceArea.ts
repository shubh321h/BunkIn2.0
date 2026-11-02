// Service-area checks that run on the server. The database (assert_service_area) is the authority for the owner-set rules
// (PIN codes + radius). This adds an independent check: what an OpenStreetMap-based geocoder says is at the coordinates.
import { HttpError, Row, Tx, Env } from './lib.ts';

export const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

/**
 * Rejects an address whose coordinates the geocoder places in a different PIN code than the allowed ones.
 * Fails OPEN when the geocoder is unreachable or knows no PIN code for that spot (OpenStreetMap coverage of Indian PIN codes
 * is incomplete), because the database rules above still apply. Every such case is logged.
 */
export async function crossCheckServiceArea(sql: Tx, env: Env, lat: number, lng: number, requestId: string): Promise<void> {
  if (!env.reverseGeocode) return;
  const [r] = await sql`select service_pincodes, service_area_label from public.restaurant` as Row[];
  const allowed: string[] = r?.service_pincodes ?? [];
  if (!allowed.length) return;
  let found: string | undefined;
  try {
    const hit = await env.reverseGeocode(lat, lng);
    found = hit?.postcode ? digits(hit.postcode) : undefined;
  } catch (e) {
    console.warn(JSON.stringify({ requestId, level: 'warn', event: 'geocoder_unavailable', message: String((e as Error)?.message ?? e).slice(0, 120) }));
    return;
  }
  if (!found || found.length !== 6) { console.warn(JSON.stringify({ requestId, level: 'warn', event: 'geocoder_no_postcode' })); return; }
  if (!allowed.includes(found)) {
    throw new HttpError(409, `Delivery is currently available only in ${r.service_area_label}. This location is in PIN code ${found}, which is outside the service area.`, 'OUT_OF_AREA');
  }
}
