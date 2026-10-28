import React,{useState} from 'react';
import { FlatList } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { homePath,MIN_STAFF_PASSWORD } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { messageOf } from '../lib/utils';
import { Button, EmptyState, Field, layout, Notice, Panel, Txt, useColors } from '../components/ui';
export default function ChangePasswordScreen(){
 const {profile,setProfile,signOut,notify}=useApp();const c=useColors();
 const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 if(!profile)return <EmptyState icon="lock-closed-outline" title="Sign in first" description="Sign in to change your password." action="Sign in" onPress={()=>router.replace('/auth')}/>;
 const forced=!!profile.mustChangePassword;const min=profile.role==='customer'?8:MIN_STAFF_PASSWORD;
 const submit=async()=>{
  setError('');
  if(password.length<min){setError(`Choose a password with at least ${min} characters.`);return;}
  if(password!==confirm){setError('The two passwords do not match.');return;}
  if(!supabase){setError('Password changes are unavailable because the app is not configured.');return;}
  setBusy(true);
  try{
   const {error:updateError}=await supabase.auth.updateUser({password});if(updateError)throw updateError;
   const updated=await api.passwordChanged();setProfile(updated);notify('Your password has been updated.','success');
   const home=homePath(updated.role);router.replace((home==='/'?'/account':home) as any);
  }catch(e){setError(messageOf(e));}finally{setBusy(false);}
 };
 return <FlatList data={[1]} keyboardShouldPersistTaps="handled" contentContainerStyle={[layout.content,{maxWidth:570,paddingTop:45}]} renderItem={()=> <Panel style={{padding:32}}>
  <Txt weight="extra" style={{fontSize:27,letterSpacing:-1,color:c.ink}}>{forced?'Choose your own password':'Change your password'}</Txt>
  <Txt style={{fontSize:12,color:c.muted,marginTop:12,lineHeight:22,marginBottom:26}}>{forced?'Your restaurant gave you a temporary password. Set a private one now. You will use it from here on.':'Pick a new password for your account.'}</Txt>
  <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder={`At least ${min} characters`}/>
  <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" onSubmitEditing={submit}/>
  {!!error&&<Notice kind="error">{error}</Notice>}
  <Button title="Save password" loading={busy} onPress={submit}/>
  {forced&&<Button title="Sign out" variant="ghost" small onPress={()=>signOut().then(()=>router.replace('/auth')).catch(e=>notify(messageOf(e),'error'))} style={{marginTop:14}}/>}
 </Panel>}/>;
}
