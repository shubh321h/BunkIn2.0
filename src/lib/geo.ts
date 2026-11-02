// Location maths and address parsing. Pure functions (no React, no network) so they can be tested on their own.
import { Coordinates } from './types';

export interface ParsedAddress { line: string; area: string; city: string; state: string; pincode: string; label: string }

/** Returns a clean 6-digit Indian PIN code, or '' if the text has none. Accepts "224001", "224 001", "224001;224002". */
export function normalizePincode(value: unknown): string {
  const m = String(value ?? '').match(/(?<!\d)(\d{3})\s?(\d{3})(?!\d)/);
  return m ? m[1] + m[2] : '';
}

const first = (...values: unknown[]) => values.map(v => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? '';
const unique = (list: string[]) => list.filter((v, i) => v && list.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);

/** Turns one OpenStreetMap Nominatim result (search or reverse, with addressdetails=1) into the fields of our address form. */
export function parseNominatim(item: any): ParsedAddress {
  const a = item?.address ?? {};
  const display = typeof item?.display_name === 'string' ? item.display_name : '';
  const street = [first(a.house_number), first(a.road, a.pedestrian, a.footway, a.path, a.residential)].filter(Boolean).join(' ');
  const city = first(a.city, a.town, a.municipality, a.village, a.county, a.state_district);
  const locality = unique([first(a.neighbourhood), first(a.suburb, a.quarter, a.city_district, a.hamlet)]);
  const line = street || first(a.amenity, a.building, a.shop, a.neighbourhood) || display.split(',')[0]?.trim() || '';
  const area = unique([...locality.filter(l => l !== line), city]).join(', ');
  return { line, area, city, state: first(a.state), pincode: normalizePincode(a.postcode), label: display };
}

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const hasLocation = (c?: Coordinates | null): c is Coordinates => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && (c.lat !== 0 || c.lng !== 0);

export interface ServiceArea { location: Coordinates; radius?: number; servicePincodes?: string[]; serviceAreaLabel?: string }
export type ServiceCheck = { ok: true } | { ok: false; code: 'PINCODE_MISSING' | 'OUT_OF_AREA' | 'OUT_OF_RANGE'; message: string };

/**
 * The same two rules the server enforces: the PIN code must be one we serve, and the position must be inside the delivery
 * radius around the kitchen. The server decides; this lets the app explain the problem before anyone tries to order.
 */
export function checkServiceArea(position: Coordinates, pincode: string, area: ServiceArea): ServiceCheck {
  const label = area.serviceAreaLabel || 'our delivery area';
  const allowed = area.servicePincodes ?? [];
  const pin = normalizePincode(pincode);
  if (allowed.length) {
    if (!pin) return { ok: false, code: 'PINCODE_MISSING', message: 'Enter the 6-digit PIN code of this address.' };
    if (!allowed.includes(pin)) return { ok: false, code: 'OUT_OF_AREA', message: `Delivery is currently available only in ${label}. PIN code ${pin} is outside the service area.` };
  }
  if (hasLocation(area.location) && area.radius && area.radius > 0) {
    const km = distanceKm(area.location, position);
    if (km > area.radius) return { ok: false, code: 'OUT_OF_RANGE', message: `This location is ${km.toFixed(1)} km from our kitchen. We deliver within ${area.radius} km, in ${label}.` };
  }
  return { ok: true };
}
