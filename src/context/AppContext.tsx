import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform, useColorScheme } from 'react-native';
import * as Linking from 'expo-linking';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Address, CartLine, Coupon, Food, Option, Profile, Restaurant } from '../lib/types';
import { messageOf } from '../lib/utils';
interface Toast { message:string; kind:'success'|'error'|'info' }
interface State {
 foods:Food[];restaurant:Restaurant;offers:Coupon[];offersError:string;loading:boolean;error:string;refresh:()=>Promise<void>;
 cart:CartLine[];addToCart:(food:Food,quantity?:number,variant?:Option,addons?:Option[],spice?:string,instructions?:string)=>void;updateQuantity:(key:string,quantity:number)=>void;clearCart:()=>void;
 favorites:string[];toggleFavorite:(id:string)=>void;
 addresses:Address[];address:Address;selectAddress:(id:string)=>void;saveAddress:(value:Address)=>Promise<void>;
 coupon:Coupon|undefined;setCoupon:(value:Coupon|undefined)=>void;
 profile:Profile|null;setProfile:(value:Profile|null)=>void;sessionReady:boolean;signOut:()=>Promise<void>;
 toast:Toast|null;notify:(message:string,kind?:Toast['kind'])=>void;
 modal:'addresses'|'notifications'|'support'|'welcome'|null;setModal:(value:State['modal'])=>void;
 theme:'light'|'dark';setTheme:(value:'light'|'dark')=>void;
}
const Context=createContext<State|null>(null);
export const useApp=()=>{const context=useContext(Context);if(!context)throw new Error('App provider is missing');return context;};
export function AppProvider({children}:{children:React.ReactNode}){
 const systemTheme=useColorScheme();const [theme,setTheme]=useState<'light'|'dark'>(systemTheme==='dark'?'dark':'light');
 const [foods,setFoods]=useState<Food[]>([]);const [offers,setOffers]=useState<Coupon[]>([]);const [offersError,setOffersError]=useState('');const [restaurant,setRestaurant]=useState<Restaurant>({name:'BunkIn Kitchen',open:false,location:{lat:12.9345,lng:77.6266},phone:'',deliveryFee:0,taxRate:0,minimumOrder:0,preparationMinutes:0});const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const [cart,setCart]=useState<CartLine[]>([]);const [favorites,setFavorites]=useState<string[]>([]);const [addresses,setAddresses]=useState<Address[]>([]);const [selectedAddress,setSelectedAddress]=useState('');
 const [coupon,setCoupon]=useState<Coupon>();const [profile,setProfile]=useState<Profile|null>(null);const [sessionReady,setSessionReady]=useState(false);const [hydrated,setHydrated]=useState(false);
 const [toast,setToast]=useState<Toast|null>(null);const [modal,setModal]=useState<State['modal']>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=(message:string,kind:Toast['kind']='info')=>{setToast({message,kind});if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),4200);};
 const refresh=async()=>{setLoading(true);setError('');api.offers().then(data=>{setOffers(data);setOffersError('');}).catch(e=>{setOffers([]);setOffersError(messageOf(e));});try{const [menu,info]=await Promise.all([api.menu(),api.restaurant()]);setFoods(menu);setRestaurant(info);}catch(e){setError(messageOf(e));}finally{setLoading(false);}};
 useEffect(()=>{refresh();AsyncStorage.getItem('bunkin-local-v1').then(raw=>{if(raw){const data=JSON.parse(raw);setCart(data.cart||[]);setFavorites(data.favorites||[]);if(data.selectedAddress)setSelectedAddress(data.selectedAddress);if(data.theme)setTheme(data.theme);}}).catch(()=>notify('Your saved items could not be restored.','error')).finally(()=>setHydrated(true));
 let active=true;
 if(Platform.OS!=='web')AsyncStorage.getItem('bunkin-onboarded').then(value=>{if(!value&&active)setModal('welcome');}).catch(()=>{});
 const load=async()=>{if(!supabase){setSessionReady(true);return;}try{const {data}=await supabase.auth.getSession();if(data.session){const me=await api.profile();if(active){setProfile(me);setAddresses(await api.addresses());}}}catch(e){if(active)notify(messageOf(e),'error');}finally{if(active)setSessionReady(true);}};load();
 const authSubscription=supabase?.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){setProfile(null);setAddresses([]);}else if(event==='SIGNED_IN'&&session){setTimeout(()=>{api.profile().then(me=>{if(active)setProfile(me);}).catch(e=>notify(messageOf(e),'error'));api.addresses().then(a=>{if(active)setAddresses(a);}).catch(()=>{});},0);}});
 const appSubscription=AppState.addEventListener('change',state=>{if(state==='active')supabase?.auth.startAutoRefresh();else supabase?.auth.stopAutoRefresh();});
 const handleAuthURL=async(url:string|null)=>{if(Platform.OS==='web'||!url||!supabase)return;try{const parsed=new URL(url);if(parsed.protocol!=='bunkin:')return;const code=parsed.searchParams.get('code');if(code){const {error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error;}}catch(e){notify(messageOf(e),'error');}};
 const urlSubscription=Linking.addEventListener('url',event=>{void handleAuthURL(event.url);});if(Platform.OS!=='web')Linking.getInitialURL().then(handleAuthURL).catch(()=>{});
 return()=>{active=false;authSubscription?.data.subscription.unsubscribe();appSubscription.remove();urlSubscription.remove();if(timer.current)clearTimeout(timer.current);};},[]);
 useEffect(()=>{if(hydrated)AsyncStorage.setItem('bunkin-local-v1',JSON.stringify({cart,favorites,selectedAddress,theme})).catch(()=>notify('Could not save changes on this device.','error'));},[cart,favorites,selectedAddress,theme,hydrated]);
 const addToCart=(food:Food,quantity=1,variant=food.variants[0],addons:Option[]=[],spice='Medium',instructions='')=>{
 if(!food.available){notify('This dish is currently sold out.','error');return;}
 const key=[food.id,variant.id,...addons.map(a=>a.id).sort(),spice,instructions].join('|');
 setCart(old=>{const existing=old.find(l=>l.key===key);return existing?old.map(l=>l.key===key?{...l,quantity:l.quantity+quantity}:l):[...old,{key,food,quantity,variant,addons,spice,instructions}];});notify(`${food.name} added to your bag`,'success');
 };
 const saveAddress=async(address:Address)=>{const saved=await api.saveAddress(address);setAddresses(old=>[...old.filter(a=>a.id!==saved.id),saved]);setSelectedAddress(saved.id);notify('Delivery address saved.','success');};
 const signOut=async()=>{if(supabase){const {error}=await supabase.auth.signOut();if(error)throw error;}setProfile(null);setCart([]);setCoupon(undefined);setAddresses([]);notify('You have been signed out.');};
 return <Context.Provider value={{foods,restaurant,offers,offersError,loading,error,refresh,cart,addToCart,updateQuantity:(key,q)=>setCart(old=>q<=0?old.filter(l=>l.key!==key):old.map(l=>l.key===key?{...l,quantity:q}:l)),clearCart:()=>{setCart([]);setCoupon(undefined);},favorites,toggleFavorite:(id)=>setFavorites(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]),addresses,address:addresses.find(a=>a.id===selectedAddress)||addresses[0]||{id:'',label:'Home',line:'Choose a delivery address',area:'Set your location',contact:'',phone:'',location:restaurant.location},selectAddress:setSelectedAddress,saveAddress,coupon,setCoupon,profile,setProfile,sessionReady,signOut,toast,notify,modal,setModal,theme,setTheme}}>{children}</Context.Provider>;
}
