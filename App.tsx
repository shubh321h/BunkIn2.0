import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { AppProvider, useApp } from './src/context/AppContext';
import { Shell } from './src/components/Shell';
import GlobalDialogs from './src/components/GlobalDialogs';
import { Icon, Txt, useColors } from './src/components/ui';
import { appConfigured, missingConfig } from './src/lib/config';

SplashScreen.preventAutoHideAsync().catch(() => {});
function AppFrame({ children }: { children: React.ReactNode }) {
  const { toast, theme } = useApp();
  const c = useColors();
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.white }} edges={['top', 'left', 'right', 'bottom']}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <Shell>{children}</Shell>
    <GlobalDialogs />
    {toast && <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)} accessibilityLiveRegion="polite" style={{ position: 'absolute', bottom: 85, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: 470, marginHorizontal: 20, paddingHorizontal: 21, paddingVertical: 17, backgroundColor: toast.kind === 'error' ? '#783E32' : '#1D4534', borderRadius: 13, shadowColor: '#102418', shadowOffset: { width: 0, height: 6 }, shadowOpacity: .2, shadowRadius: 15, elevation: 10, zIndex: 9999 }}>
      <Icon name={toast.kind === 'error' ? 'alert-circle-outline' : toast.kind === 'success' ? 'checkmark-circle' : 'information-circle-outline'} size={20} color="#E1EBCF" />
      <Txt weight="medium" style={{ color: '#fff', fontSize: 12, lineHeight: 19, flexShrink: 1 }}>{toast.message}</Txt>
    </Animated.View>}
  </SafeAreaView>;
}
export default function App({ children }: { children?: React.ReactNode }) {
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font,
    Jakarta: require('./assets/fonts/Jakarta-Regular.ttf'),
    JakartaMedium: require('./assets/fonts/Jakarta-Medium.ttf'),
    JakartaSemi: require('./assets/fonts/Jakarta-SemiBold.ttf'),
    JakartaBold: require('./assets/fonts/Jakarta-Bold.ttf'),
    JakartaExtra: require('./assets/fonts/Jakarta-ExtraBold.ttf'),
  });
  useEffect(() => { if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded, fontError]);
  useEffect(() => { if (Platform.OS === 'web') { document.title = 'BunkIn · Good food. Right here.'; const style = document.createElement('style'); style.innerHTML = 'body{background:#F7F8F5}*{-webkit-tap-highlight-color:transparent}input:focus-visible,textarea:focus-visible{outline:2px solid #94b47e!important;outline-offset:3px}::-webkit-scrollbar{width:5px;height:4px}::-webkit-scrollbar-thumb{background:#DCE2D5;border-radius:9px}'; document.head.appendChild(style); return () => style.remove(); } }, []);
  if (!appConfigured) return <View style={{ flex: 1, backgroundColor: '#F7F8F5', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
    <Text style={{ fontSize: 20, fontWeight: '700', color: '#18211C', textAlign: 'center' }}>BunkIn isn’t set up yet</Text>
    <Text style={{ fontSize: 14, color: '#52624E', textAlign: 'center', marginTop: 12, lineHeight: 22, maxWidth: 420 }}>This app can’t reach its service right now. Please contact the restaurant.</Text>
    {__DEV__ && <Text style={{ fontSize: 12, color: '#783E32', textAlign: 'center', marginTop: 18 }}>Missing: {missingConfig.join(', ')}</Text>}
  </View>;
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: '#F7F8F5', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#156449" size="large" /></View>;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppProvider><AppFrame>{children}</AppFrame></AppProvider></SafeAreaProvider></GestureHandlerRootView>;
}

