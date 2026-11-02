import React,{useMemo,useRef,useState,useEffect} from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { config } from '../lib/config';
import { mapHTML, MapProps } from '../lib/maps';
import { Notice } from './ui';
export default function OSMMap({markers,route,height=320,center,pick,onPinChange,onError}:MapProps){const ref=useRef<WebView>(null);const [error,setError]=useState('');const markerKey=markers.map(m=>m.id).join(',');const routeKey=JSON.stringify(route);const html=useMemo(()=>mapHTML(markers,route,{center,pick}),[markerKey,routeKey,center?.lat,center?.lng,pick]);
 useEffect(()=>{ref.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({type:'update',markers}).replace(/</g,'\\u003c')}}));true;`);},[markers]);
 return <View style={{height:height+(error?80:0),borderRadius:15,overflow:'hidden'}}><WebView ref={ref} source={{html,baseUrl:config.supabaseUrl||'https://localhost'}} userAgent="BunkInDelivery/1.0 (Android; food delivery app)" originWhitelist={['https://*','about:*']} javaScriptEnabled domStorageEnabled cacheEnabled mixedContentMode="never" onMessage={event=>{try{const d=JSON.parse(event.nativeEvent.data);if(d.type==='pin')onPinChange?.(d.location);if(d.type==='error'){setError(d.message);onError?.(d.message);}}catch{setError('Map response could not be read.');}}} onError={()=>setError('Map unavailable. Please check your internet connection.')} style={{height}}/>{!!error&&<Notice>{error}</Notice>}</View>;
                                                                                                   }
