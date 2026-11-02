// The page shown inside the map WebView / iframe: Leaflet + OpenStreetMap-compatible tiles. No React, no config imports.
import { Coordinates } from './types';

export interface MapMarker { id: string; label: string; location: Coordinates; color: string; draggable?: boolean }

/** OpenStreetMap's own tile server. Fine for light, attributed use (a single restaurant). For heavy traffic set EXPO_PUBLIC_TILE_URL to a provider you have an account with. */
export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
// Leaflet 1.9.4 files are pinned and verified with Subresource Integrity: the browser refuses them if the CDN serves anything else.
export const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
export const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

export interface MapHtmlOptions {
  markers: MapMarker[]; route?: [number, number][]; tileUrl?: string; attribution?: string;
  /** Where to look when there are no markers. Omit to show all of India instead of guessing a place. */
  center?: Coordinates;
  /** Let a tap on the map report a position even when no draggable marker exists yet. */
  pick?: boolean;
}

export function buildMapHtml(o: MapHtmlOptions): string {
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const tile = o.tileUrl || DEFAULT_TILE_URL;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="${LEAFLET_CSS_SRI}" crossorigin=""><style>html,body,#map{height:100%;width:100%;margin:0;font-family:Arial;background:#edf0e5}.pin{border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 8px #0003;width:22px;height:22px}.leaflet-control-attribution{font-size:9px!important}.fallback{padding:40px;text-align:center;color:#52624e;font-size:13px;line-height:1.7}</style></head><body><div id="map"></div><script>function send(data){const msg=JSON.stringify(data);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(msg);else window.parent.postMessage({bunkin:true,...data},'*')}window.onerror=function(){send({type:'error',message:'Map unavailable. Check your connection or open directions.'})};</script><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="${LEAFLET_JS_SRI}" crossorigin=""></script><script>
 const tile=${safe(tile)},data=${safe(o.markers)},route=${safe(o.route || [])},center=${safe(o.center || null)},pick=${safe(!!o.pick)};let map,markerRefs={};
 if(typeof L!=='undefined'){map=L.map('map',{scrollWheelZoom:false});let failures=0;L.tileLayer(tile,{maxZoom:19,attribution:${safe(o.attribution || DEFAULT_ATTRIBUTION)}}).on('tileerror',()=>{if(++failures===4)send({type:'error',message:'Map tiles could not load. Check your connection.'})}).addTo(map);
 data.forEach(m=>{let marker=L.marker([m.location.lat,m.location.lng],{draggable:!!m.draggable,icon:L.divIcon({className:'',html:'<div class="pin" style="background:'+m.color+'"></div>',iconSize:[28,28],iconAnchor:[14,28]})}).addTo(map);let label=document.createElement('span');label.textContent=m.label;marker.bindTooltip(label);markerRefs[m.id]=marker;if(m.draggable)marker.on('dragend',e=>{let p=e.target.getLatLng();send({type:'pin',location:{lat:p.lat,lng:p.lng}})});});
 const drag=data.find(m=>m.draggable);
 if(drag)map.setView([drag.location.lat,drag.location.lng],16);
 else if(data.length>1)map.fitBounds(data.map(m=>[m.location.lat,m.location.lng]),{padding:[45,45],maxZoom:15});
 else if(data[0])map.setView([data[0].location.lat,data[0].location.lng],15);
 else if(center)map.setView([center.lat,center.lng],14);
 else map.setView([22.9,79.6],4);
 if(route.length)L.polyline(route.map(p=>[p[1],p[0]]),{color:'#156449',weight:5,opacity:.85}).addTo(map);
 map.on('click',e=>{let m=data.find(x=>x.draggable);if(m){markerRefs[m.id].setLatLng(e.latlng);send({type:'pin',location:{lat:e.latlng.lat,lng:e.latlng.lng}})}else if(pick){send({type:'pin',location:{lat:e.latlng.lat,lng:e.latlng.lng}})}});
 send({type:'ready'});window.addEventListener('message',e=>{try{const v=typeof e.data==='string'?JSON.parse(e.data):e.data;if(v?.type==='update')v.markers.forEach(m=>{const p=[m.location.lat,m.location.lng];markerRefs[m.id]?.setLatLng(p);if(m.draggable&&!map.getBounds().contains(p))map.panTo(p)});}catch{}});
 }else{document.getElementById('map').innerHTML='<div class="fallback">The map could not load.<br>Please check your connection, or enter your address below.</div>';send({type:'error',message:'The map could not load. Check your connection.'})}
 </script></body></html>`;
}
