import React,{useEffect,useMemo,useRef,useState} from 'react';
import { View } from 'react-native';
import { mapHTML, MapProps } from '../lib/maps';
import { Notice } from './ui';
export default function OSMMap({markers,route,height=320,onPinChange,onError}:MapProps){const ref=useRef<HTMLIFrameElement>(null);const [error,setError]=useState('');const markerKey=markers.map(m=>m.id).join(',');const routeKey=JSON.stringify(route);const initial=useMemo(()=>mapHTML(markers,route),[markerKey,routeKey]);
 useEffect(()=>{const listener=(e:MessageEvent)=>{if(e.source!==ref.current?.contentWindow||!e.data?.bunkin)return;if(e.data.type==='pin')onPinChange?.(e.data.location);if(e.data.type==='error'){setError(e.data.message);onError?.(e.data.message);}if(e.data.type==='ready')setError('');};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[onPinChange,onError]);
 useEffect(()=>{ref.current?.contentWindow?.postMessage({type:'update',markers},'*');},[markers]);
 return <View style={{borderRadius:15,overflow:'hidden',backgroundColor:'#E9EDE3'}}><iframe ref={ref} title="BunkIn OpenStreetMap delivery map" srcDoc={initial} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" style={{height,width:'100%',border:0,display:'block'}}/>{!!error&&<View style={{paddingHorizontal:10}}><Notice>{error}</Notice></View>}</View>;
}
