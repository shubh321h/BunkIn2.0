export const config = {
 apiUrl: process.env.EXPO_PUBLIC_API_URL || '',
 supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
 supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
 tileUrl: process.env.EXPO_PUBLIC_TILE_URL || '',
 tileAttribution: process.env.EXPO_PUBLIC_TILE_ATTRIBUTION || '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
 routingUrl: process.env.EXPO_PUBLIC_ROUTING_URL || '',
 // Address search and reverse lookup use OpenStreetMap Nominatim by default. It is for light use: searches only run when the customer taps Search.
 // For real traffic point these at your own Nominatim or a paid OSM-based provider.
 geocodingUrl: process.env.EXPO_PUBLIC_GEOCODING_URL || 'https://nominatim.openstreetmap.org/search',
 reverseGeocodingUrl: process.env.EXPO_PUBLIC_REVERSE_GEOCODING_URL || (process.env.EXPO_PUBLIC_GEOCODING_URL ? process.env.EXPO_PUBLIC_GEOCODING_URL.replace(/\/search\/?$/, '/reverse') : 'https://nominatim.openstreetmap.org/reverse'),
};
export const authConfigured = !!(config.supabaseUrl && config.supabaseKey);
// There is no demo mode. The app needs its backend and auth service to run at all.
export const missingConfig = ([['EXPO_PUBLIC_API_URL', config.apiUrl], ['EXPO_PUBLIC_SUPABASE_URL', config.supabaseUrl], ['EXPO_PUBLIC_SUPABASE_ANON_KEY', config.supabaseKey]] as const).filter(([, value]) => !value).map(([name]) => name);
export const appConfigured = missingConfig.length === 0;
