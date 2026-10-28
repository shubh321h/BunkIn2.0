import { Linking, Platform } from 'react-native';
import { config } from './config';
import { Coordinates } from './types';
let lastGeocode=0;const cache=new Map<string,{label:string;location:Coordinates}[]>();
export async function searchAddresses(query:string){
 if(!config.geocodingUrl)throw new Error('Address search is not connected yet. Enter your address manually and drag the map pin.');
 if(query.trim().length<3)throw new Error('Enter at least 3 characters to search.');
 const cached=cache.get(query);if(cached)return cached;
 if(Date.now()-lastGeocode<1100)throw new Error('Please wait a moment before searching again.');lastGeocode=Date.now();
 const response=await fetch(`${config.geocodingUrl}?q=${encodeURIComponent(query)}&format=json&limit=5`);if(!response.ok)throw new Error('Address lookup is unavailable. Please enter the address manually.');
 const data=await response.json();const result=data.map((r:any)=>({label:r.display_name as string,location:{lat:Number(r.lat),lng:Number(r.lon)}}));cache.set(query,result);return result as {label:string;location:Coordinates}[];
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
export interface MapMarker {id:string;label:string;location:Coordinates;color:string;draggable?:boolean}
export interface MapProps {markers:MapMarker[];route?:[number,number][];height?:number;onPinChange?:(location:Coordinates)=>void;onError?:(message:string)=>void}
export function mapHTML(markers:MapMarker[], route:[number,number][]|undefined,native=false){
 const safe=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
 const tile=config.tileUrl||(!native?'https://tile.openstreetmap.org/{z}/{x}/{y}.png':'');
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{height:100%;width:100%;margin:0;font-family:Arial;background:#edf0e5}.pin{border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 8px #0003;width:22px;height:22px}.leaflet-control-attribution{font-size:9px!important}.fallback{padding:40px;text-align:center;color:#52624e;font-size:13px;line-height:1.7}</style></head><body><div id="map"></div><script>function send(data){const msg=JSON.stringify(data);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(msg);else window.parent.postMessage({bunkin:true,...data},'*')}window.onerror=function(){send({type:'error',message:'Map unavailable. Check your connection or open directions.'})};</script><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
 const tile=${safe(tile)},data=${safe(markers)},route=${safe(route||[])};let map,markerRefs={};
 if(!tile){document.getElementById('map').innerHTML='<div class="fallback">A native tile provider is not configured.<br>Set EXPO_PUBLIC_TILE_URL to your licensed OSM-compatible provider.<br>You can still open directions in your navigation app.</div>';send({type:'error',message:'Map provider is not configured for Android.'})}
 else if(typeof L!=='undefined'){map=L.map('map',{scrollWheelZoom:false}).setView([12.9345,77.6266],14);let failures=0;L.tileLayer(tile,{maxZoom:19,attribution:${safe(config.tileAttribution)}}).on('tileerror',()=>{if(++failures===4)send({type:'error',message:'Map tiles could not load. Check your connection.'})}).addTo(map);
 data.forEach(m=>{let marker=L.marker([m.location.lat,m.location.lng],{draggable:!!m.draggable,icon:L.divIcon({className:'',html:'<div class="pin" style="background:'+m.color+'"></div>',iconSize:[28,28],iconAnchor:[14,28]})}).addTo(map);let label=document.createElement('span');label.textContent=m.label;marker.bindTooltip(label);markerRefs[m.id]=marker;if(m.draggable)marker.on('dragend',e=>{let p=e.target.getLatLng();send({type:'pin',location:{lat:p.lat,lng:p.lng}})});});
 if(data.length>1)map.fitBounds(data.map(m=>[m.location.lat,m.location.lng]),{padding:[45,45],maxZoom:15});else if(data[0])map.setView([data[0].location.lat,data[0].location.lng],15);
 if(route.length)L.polyline(route.map(p=>[p[1],p[0]]),{color:'#156449',weight:5,opacity:.85}).addTo(map);
 map.on('click',e=>{let m=data.find(x=>x.draggable);if(m){markerRefs[m.id].setLatLng(e.latlng);send({type:'pin',location:{lat:e.latlng.lat,lng:e.latlng.lng}})}});
 send({type:'ready'});window.addEventListener('message',e=>{try{const v=typeof e.data==='string'?JSON.parse(e.data):e.data;if(v?.type==='update')v.markers.forEach(m=>{const p=[m.location.lat,m.location.lng];markerRefs[m.id]?.setLatLng(p);if(m.draggable&&!map.getBounds().contains(p))map.panTo(p)});}catch{}});
 }else{document.getElementById('map').innerHTML='<div class="fallback">Map unavailable while offline.<br>Please reconnect or use your navigation app.</div>'}
 </script></body></html>`;
}
