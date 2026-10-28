import React from 'react';
import { Stack } from 'expo-router';
import App from '../../App';
export default function RootLayout(){return <App><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:'transparent'},animation:'slide_from_right'}}><Stack.Screen name="(customer)" options={{animation:'none'}}/><Stack.Screen name="product/[id]" options={{presentation:'card'}}/><Stack.Screen name="checkout"/><Stack.Screen name="order/[id]"/><Stack.Screen name="auth"/><Stack.Screen name="owner"/><Stack.Screen name="rider"/></Stack></App>;}
