import { Linking, Platform } from 'react-native';
import { config } from './config';
import { Coordinates } from './types';
import { DEFAULT_TILE_URL, buildMapHtml, MapMarker } from './mapHtml';
import { ParsedAddress, parseNominatim } from './geo';
export type { MapMarker } from './mapHtml';
// OpenStreetMap's public geocoder allows about one request per second and forbids search-as-you-type, so every lookup here is
// started by a button, waits its turn, and is cached.
let lastLookup=0;
async function waitTurn(){const gap=1100-(Date.now()-lastLookup);if(gap>0)await new Promise(r=>setTimeout(r,gap));lastLookup=Date.now();}
async function lookupJson(url:string,failure:string){
 await waitTurn();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch(url,{headers:{'Accept-Language':'en','User-Agent':'BunkInDelivery/1.0 (food delivery app)'},signal:controller.signal});if(!response.ok)throw new Error(failure);return await response.json();}
 catch(e){if((e as Error).name==='AbortError')throw new Error('The address service took too long to answer. Please try again.');throw e instanceof Error&&e.message===failure?e:new Error(failure);}
 finally{clearTimeout(timer);}
}
export interface AddressResult {label:string;location:Coordinates;parsed:ParsedAddress}
const searchCache=new Map<string,AddressResult[]>();const reverseCache=new Map<string,ParsedAddress>();
/** Search for an address. `near` only biases results towards the kitchen; it is not a delivery boundary (the server decides that). */
export async function searchAddresses(query:string,near?:Coordinates):Promise<AddressResult[]>{
 const text=query.trim();if(text.length<3)throw new Error('Enter at least 3 characters to search.');
 const key=`${text.toLowerCase()}|${near?`${near.lat.toFixed(2)},${near.lng.toFixed(2)}`:''}`;const cached=searchCache.get(key);if(cached)return cached;
 const bias=near&&(near.lat!==0||near.lng!==0)?`&viewbox=${near.lng-0.3},${near.lat+0.3},${near.lng+0.3},${near.lat-0.3}&bounded=0`:'';
 const data=await lookupJson(`${config.geocodingUrl}?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=5&countrycodes=in${bias}`,'Address search is unavailable right now. You can place the pin on the map instead.');
 const result:AddressResult[]=(Array.isArray(data)?data:[]).map((r:any)=>({label:String(r.display_name??''),location:{lat:Number(r.lat),lng:Number(r.lon)},parsed:parseNominatim(r)})).filter(r=>Number.isFinite(r.location.lat)&&Number.isFinite(r.location.lng));
 searchCache.set(key,result);return result;
}
/** What is at this map position? Returns street, area, city and PIN code when OpenStreetMap knows them. */
export async function reverseGeocode(position:Coordinates):Promise<ParsedAddress>{
 const key=`${position.lat.toFixed(4)},${position.lng.toFixed(4)}`;const cached=reverseCache.get(key);if(cached)return cached;
 const data=await lookupJson(`${config.reverseGeocodingUrl}?lat=${position.lat}&lon=${position.lng}&format=jsonv2&addressdetails=1&zoom=18`,'We could not read the address for this spot.');
 if(!data||data.error)throw new Error('We could not find an address for this spot.');
 const parsed=parseNominatim(data);reverseCache.set(key,parsed);return parsed;
}
export async function getRoute(from:Coordinates,to:Coordinates){
 if(!config.routingUrl)throw new Error('Routing is not configured. You can still open directions in your navigation app.');
 const url=`${config.routingUrl.replace(/\/$/,'')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
 const response=await fetch(url);if(!response.ok)throw new Error('Routing is unavailable. Use your navigation app for directions.');const result=await response.json();if(result.code!=='Ok'||!result.routes?.[0])throw new Error('No driving route was found.');return result.routes[0] as {geometry:{coordinates:[number,number][]};duration:number;distance:number};
}
export async function openDirections(to:Coordinates,label:string,from?:Coordinates){
 const osm=`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from?`${from.lat},${from.lng}`:''};${to.lat},${to.lng}`;
 if(Platform.OS==='web'){await Linking.openURL(osm);return;}
 const geo=`geo:${to.lat},${to.lng}?q=${to.lat},${to.lng}(${encodeURIComponent(label)})`;
 try{await Linking.openURL(geo);}catch{await Linking.openURL(osm);}
}
export interface MapProps {markers:MapMarker[];route?:[number,number][];height?:number;/** Where to look when there are no markers (omit to show all of India, never a guessed city). */center?:Coordinates;/** Allow a tap to place the first pin. */pick?:boolean;onPinChange?:(location:Coordinates)=>void;onError?:(message:string)=>void}
/** The map page. Always has tiles: EXPO_PUBLIC_TILE_URL if set, otherwise OpenStreetMap's own server (light use, attributed). */
export function mapHTML(markers:MapMarker[],route?:[number,number][],extra:{center?:Coordinates;pick?:boolean}={}){
 return buildMapHtml({markers,route,tileUrl:config.tileUrl||DEFAULT_TILE_URL,attribution:config.tileAttribution,...extra});
}
