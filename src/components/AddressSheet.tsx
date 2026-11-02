import React,{useEffect,useRef,useState} from 'react';
import { Linking, Pressable, View } from 'react-native';
import * as Location from 'expo-location';
import { useApp } from '../context/AppContext';
import { ParsedAddress, checkServiceArea, hasLocation, normalizePincode } from '../lib/geo';
import { AddressResult, reverseGeocode, searchAddresses } from '../lib/maps';
import { Coordinates } from '../lib/types';
import { messageOf, validPhone } from '../lib/utils';
import OSMMap from './OSMMap';
import { Button, EmptyState, Field, Icon, Notice, Sheet, Txt, useColors } from './ui';

type Status = 'idle' | 'locating' | 'reading' | 'searching' | 'saving';
const withTimeout = <T,>(work: Promise<T>, ms: number, message: string) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

/** The delivery address picker: detect the location, search, or place the pin; check the delivery area before saving. */
export default function AddressSheet(){
 const {modal,setModal,addresses,address,selectAddress,saveAddress,restaurant,profile}=useApp();const c=useColors();
 const visible=modal==='addresses';const close=()=>setModal(null);
 const [adding,setAdding]=useState(false);const [label,setLabel]=useState('Home');const [line,setLine]=useState('');const [area,setArea]=useState('');const [city,setCity]=useState('');const [pincode,setPincode]=useState('');
 const [contact,setContact]=useState('');const [phone,setPhone]=useState('');
 // `pin` stays null until the customer really sets a place (GPS, search or the map). Nothing is guessed.
 const [pin,setPin]=useState<Coordinates|null>(null);const [accuracy,setAccuracy]=useState<number|null>(null);
 const [status,setStatus]=useState<Status>('idle');const [error,setError]=useState('');const [issue,setIssue]=useState<{message:string;settings?:boolean}|null>(null);const [readNote,setReadNote]=useState('');
 const [lookup,setLookup]=useState('');const [results,setResults]=useState<AddressResult[]>([]);
 const typedAddress=useRef(false);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{if(visible){setAdding(false);setError('');}},[visible]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);

 const kitchen=hasLocation(restaurant.location)?restaurant.location:undefined;
 const service={location:restaurant.location,radius:restaurant.radius,servicePincodes:restaurant.servicePincodes,serviceAreaLabel:restaurant.serviceAreaLabel};
 const check=pin?checkServiceArea(pin,pincode,service):null;
 const areaLabel=restaurant.serviceAreaLabel||'our delivery area';

 const apply=(p:ParsedAddress,force:boolean)=>{
  if(force)typedAddress.current=false;
  if(p.pincode)setPincode(p.pincode);if(p.city)setCity(p.city);
  if(force||!typedAddress.current){if(p.line)setLine(p.line);if(p.area)setArea(p.area);}
 };
 const readAddress=async(position:Coordinates,force:boolean)=>{
  setStatus('reading');setReadNote('');
  try{apply(await reverseGeocode(position),force);}
  catch(e){setReadNote(`${messageOf(e)} Type your address below and check the PIN code.`);}
  finally{setStatus(s=>s==='reading'?'idle':s);}
 };
 const placePin=(position:Coordinates,force=false)=>{
  setPin(position);setAccuracy(null);setError('');setIssue(null);
  if(timer.current)clearTimeout(timer.current);
  timer.current=setTimeout(()=>{void readAddress(position,force);},force?0:700);   // wait for the finger to stop moving before looking anything up
 };
 const locate=async()=>{
  setError('');setIssue(null);setReadNote('');setResults([]);setStatus('locating');
  try{
   if(!(await Location.hasServicesEnabledAsync())){setIssue({message:'Location services are switched off on this phone. Turn on GPS in your phone settings, or search for your address below.'});return;}
   let permission=await Location.getForegroundPermissionsAsync();
   if(permission.status!=='granted')permission=await Location.requestForegroundPermissionsAsync();
   if(permission.status!=='granted'){setIssue({message:permission.canAskAgain?'Location permission was not allowed. You can allow it and try again, or search for your address below.':'Location permission is blocked for BunkIn. Allow it in your phone settings, or search for your address below.',settings:!permission.canAskAgain});return;}
   const position=await withTimeout(Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}),20000,'We could not get a GPS fix. Try again near a window or outdoors, or search for your address below.');
   placePin({lat:position.coords.latitude,lng:position.coords.longitude},true);
   setAccuracy(position.coords.accuracy??null);
  }catch(e){setIssue({message:messageOf(e)});}
  finally{setStatus(s=>s==='locating'?'idle':s);}
 };
 const search=async()=>{
  setError('');setIssue(null);setStatus('searching');
  try{const found=await searchAddresses(lookup,kitchen);setResults(found);if(!found.length)setError('No matching address was found. Try fewer words, or place the pin on the map.');}
  catch(e){setError(messageOf(e));}finally{setStatus(s=>s==='searching'?'idle':s);}
 };
 const choose=(r:AddressResult)=>{setResults([]);setPin(r.location);setAccuracy(null);setIssue(null);apply(r.parsed,true);if(!r.parsed.pincode)void readAddress(r.location,false);};
 const startAdding=()=>{typedAddress.current=false;setAdding(true);setLabel('Home');setLine('');setArea('');setCity('');setPincode('');setPin(null);setAccuracy(null);setResults([]);setLookup('');setError('');setIssue(null);setReadNote('');setContact(profile?.name||'');setPhone(profile?.phone||'');};
 const save=async()=>{
  if(!pin){setError('Set your delivery pin first: use your location, search for your address, or tap the map.');return;}
  if(line.trim().length<6||area.trim().length<3||contact.trim().length<2||!validPhone(phone)){setError('Please enter your full address, area, contact name, and a valid phone number.');return;}
  if(!/^\d{6}$/.test(normalizePincode(pincode))){setError('Enter the 6-digit PIN code of this address.');return;}
  const verdict=checkServiceArea(pin,pincode,service);if(!verdict.ok){setError(verdict.message);return;}
  setStatus('saving');setError('');
  try{await saveAddress({id:'',label,line:line.trim(),area:area.trim(),city,pincode:normalizePincode(pincode),contact:contact.trim(),phone,location:pin});close();}
  catch(e){setError(messageOf(e));}finally{setStatus('idle');}
 };
 const busy=status!=='idle';
 const markers=[...(kitchen?[{id:'kitchen',label:restaurant.name,location:kitchen,color:'#B8742A'}]:[]),...(pin?[{id:'pin',label:'Drag to your door',location:pin,color:'#156449',draggable:true}]:[])];

 return <Sheet visible={visible} title={adding?'Your happy place':'Where should we deliver?'} subtitle={adding?'A precise pin helps your rider find your door.':`Delivering in ${areaLabel}.`} onClose={close} wide={adding}>{!adding?<>
  <View style={{gap:13}}>{addresses.map(a=>{const verdict=checkServiceArea(a.location,a.pincode||'',service);return <Pressable key={a.id} onPress={()=>{selectAddress(a.id);close();}} style={{flexDirection:'row',gap:14,padding:18,borderWidth:1,borderColor:a.id===address.id?c.green:c.line,borderRadius:12,backgroundColor:a.id===address.id?'#F0F5E9':c.white}}><Icon name={a.label==='Home'?'home-outline':'location-outline'} color={c.green}/><View style={{flex:1}}><Txt weight="bold" style={{fontSize:13,color:c.ink}}>{a.label}</Txt><Txt style={{fontSize:11,color:c.muted,lineHeight:19,marginTop:7}}>{a.line}{`\n`}{a.area}{a.pincode?` · ${a.pincode}`:''}</Txt>{!verdict.ok&&<Txt style={{fontSize:10,color:'#9A4A3A',marginTop:7}}>{verdict.code==='PINCODE_MISSING'?'Add the PIN code to use this address.':'Outside our delivery area.'}</Txt>}</View>{a.id===address.id&&<Icon name="checkmark-circle" size={19} color={c.green}/>}</Pressable>;})}</View>
  {addresses.length===0&&<EmptyState title="A place to call yours" description="Add a delivery address to get started. You can browse the menu without one."/>}
  <Button title="Add a new address" icon="add" onPress={startAdding} variant="secondary" style={{marginTop:21}}/></>:<>
  <Button title="Use my current location" icon="locate-outline" onPress={locate} loading={status==='locating'} disabled={busy&&status!=='locating'}/>
  {!!issue&&<View style={{marginTop:12}}><Notice kind="error">{issue.message}</Notice>{issue.settings&&<Button title="Open phone settings" variant="ghost" small onPress={()=>{void Linking.openSettings();}} style={{marginBottom:6}}/>}</View>}
  <View style={{flexDirection:'row',gap:9,marginTop:14}}><View style={{flex:1}}><Field placeholder="Or search a street or neighbourhood" value={lookup} onChangeText={setLookup} returnKeyType="search" onSubmitEditing={search}/></View><Button title="Search" small onPress={search} loading={status==='searching'} disabled={busy&&status!=='searching'} style={{height:48}}/></View>
  {results.map(r=><Pressable key={r.label+r.location.lat} onPress={()=>choose(r)} style={{padding:12,borderBottomWidth:1,borderBottomColor:c.line}}><Txt style={{fontSize:12,color:c.ink}}>{r.label}</Txt></Pressable>)}
  <OSMMap markers={markers} center={kitchen} pick onPinChange={p=>placePin(p)} height={250}/>
  <Txt style={{fontSize:10,color:c.muted,marginTop:10,marginBottom:6}}>{pin?'Drag the pin or tap the map to fine-tune it.':'No location set yet. Use your location, search, or tap the map to place the pin.'}</Txt>
  {status==='locating'&&<Txt style={{fontSize:10,color:c.green,marginBottom:6}}>Finding your location…</Txt>}
  {status==='reading'&&<Txt style={{fontSize:10,color:c.green,marginBottom:6}}>Reading the address for this spot…</Txt>}
  {pin&&<Txt style={{fontSize:9,color:c.muted,marginBottom:10}}>{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}{accuracy!=null?` · GPS accuracy about ${Math.round(accuracy)} m`:''}</Txt>}
  {accuracy!=null&&accuracy>150&&<Notice>The GPS signal is weak, so the pin may be off. Please move it to your door.</Notice>}
  {!!readNote&&<Notice>{readNote}</Notice>}
  <View style={{flexDirection:'row',gap:9,marginTop:8,marginBottom:20}}>{['Home','Work','Other'].map(l=><Button key={l} small title={l} variant={label===l?'primary':'secondary'} onPress={()=>setLabel(l)}/>)}</View>
  <Field label="Flat, building and street" value={line} onChangeText={t=>{typedAddress.current=true;setLine(t);}} placeholder="e.g. 24, Station Road"/>
  <Field label="Area and city" value={area} onChangeText={t=>{typedAddress.current=true;setArea(t);}}/>
  <Field label="PIN code" value={pincode} onChangeText={t=>setPincode(t.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" maxLength={6} placeholder="6 digits"/>
  {pin&&check&&(check.ok?<Notice>This address is inside our delivery area: {areaLabel}.</Notice>:check.code==='PINCODE_MISSING'?<Notice>{check.message}</Notice>:<Notice kind="error">{check.message}</Notice>)}
  <Field label="Contact name" value={contact} onChangeText={setContact} autoComplete="name"/>
  <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad"/>
  {!!error&&<Notice kind="error">{error}</Notice>}
  <Button title="Save delivery address" loading={status==='saving'} disabled={busy&&status!=='saving'} onPress={save}/></>}</Sheet>;
   }
