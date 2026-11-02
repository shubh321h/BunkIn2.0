import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useApp} from '../context/AppContext';
import {api} from '../lib/api';
import {authLinkProblem,passwordProblem} from '../lib/authLinks';
import {supabase} from '../lib/supabase';
import {messageOf} from '../lib/utils';
import {Button,Field,Notice,Panel,SectionTitle,Txt,layout,useColors} from '../components/ui';
type Phase='checking'|'ready'|'invalid'|'done';
export default function ResetPasswordScreen(){
 const params=useLocalSearchParams<{code?:string;error?:string;error_code?:string;error_description?:string}>();
 const {setProfile,notify}=useApp();const c=useColors();
 const [phase,setPhase]=useState<Phase>('checking');const [problem,setProblem]=useState('');
 const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const started=useRef<string>('');
 // Verify the link: exchange its one-time code for a short recovery session. Errors in the link are explained, never ignored.
 useEffect(()=>{
  const key=`${params.code??''}|${params.error??''}|${params.error_code??''}`;if(started.current===key)return;started.current=key;
  const fail=(message:string)=>{setProblem(message);setPhase('invalid');};
  (async()=>{
   if(!supabase){fail('Sign-in is not set up on this app yet. Please contact the restaurant.');return;}
   if(params.error||params.error_code||params.error_description){fail(authLinkProblem(params.error_code,params.error_description));return;}
   if(params.code){const {error:e}=await supabase.auth.exchangeCodeForSession(params.code);if(e){fail(authLinkProblem(e.code,e.message));return;}setPhase('ready');return;}
   const {data}=await supabase.auth.getSession();
   if(data.session)setPhase('ready');else fail('Open the reset link from your email on this phone, or request a new one.');
  })().catch(e=>fail(messageOf(e)));
 },[params.code,params.error,params.error_code,params.error_description]);
 const reset=async()=>{
  const bad=passwordProblem(password,confirmation);if(bad){setError(bad);return;}
  if(!supabase){setError('Sign-in is not set up on this app yet.');return;}
  setBusy(true);setError('');
  try{
   const {data}=await supabase.auth.getSession();if(!data.session){setPhase('invalid');setProblem('Your reset session ended. Request a new link.');return;}
   const {error:e}=await supabase.auth.updateUser({password});if(e)throw e;
   await supabase.auth.signOut({scope:'others'}).catch(()=>{});   // every other signed-in device must use the new password
   api.passwordChanged().then(setProfile).catch(()=>{});          // clears "choose your own password" for staff, harmless for customers
   setPassword('');setConfirmation('');setPhase('done');notify('Your password has been updated.','success');
  }catch(e){setError(messageOf(e));}finally{setBusy(false);}
 };
 if(phase==='checking')return <View style={[layout.content,{maxWidth:550}]}><Panel><SectionTitle title="One moment." subtitle="Checking your secure reset link…"/></Panel></View>;
 if(phase==='invalid')return <View style={[layout.content,{maxWidth:550}]}><Panel><SectionTitle title="This link can’t be used." subtitle="Reset links work once and expire after a short time."/><Notice kind="error">{problem}</Notice><Button title="Request a new link" onPress={()=>router.replace({pathname:'/auth',params:{mode:'reset'}})}/><Button title="Back to sign in" variant="ghost" small onPress={()=>router.replace('/auth')} style={{marginTop:14}}/></Panel></View>;
 if(phase==='done')return <View style={[layout.content,{maxWidth:550}]}><Panel><SectionTitle title="All set." subtitle="Your password has been changed."/><Txt style={{fontSize:12,color:c.muted,marginBottom:20}}>Use your new password the next time you sign in.</Txt><Button title="Continue" onPress={()=>router.replace('/account')}/></Panel></View>;
 return <View style={[layout.content,{maxWidth:550}]}><Panel><SectionTitle title="A fresh start." subtitle="Choose a new secure password for your account."/><Field label="New password" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword}/><Field label="Confirm password" secureTextEntry autoCapitalize="none" value={confirmation} onChangeText={setConfirmation} onSubmitEditing={reset}/>{!!error&&<Notice kind="error">{error}</Notice>}<Button title="Update password" onPress={reset} loading={busy}/></Panel></View>;
}
