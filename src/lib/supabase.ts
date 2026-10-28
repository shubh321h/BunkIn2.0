import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { authConfigured, config } from './config';
const storage = {
 async getItem(key: string) { if(Platform.OS==='web') return typeof sessionStorage==='undefined'?null:sessionStorage.getItem(key); return SecureStore.getItemAsync(key); },
 async setItem(key: string,value: string) { if(Platform.OS==='web') { if(typeof sessionStorage!=='undefined') sessionStorage.setItem(key,value); } else await SecureStore.setItemAsync(key,value); },
 async removeItem(key: string) { if(Platform.OS==='web') { if(typeof sessionStorage!=='undefined') sessionStorage.removeItem(key); } else await SecureStore.deleteItemAsync(key); },
};
export const supabase = authConfigured ? createClient(config.supabaseUrl,config.supabaseKey,{auth:{storage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:Platform.OS==='web',flowType:'pkce'}}) : null;
