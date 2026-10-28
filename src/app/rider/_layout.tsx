import React from 'react';
import {Stack} from 'expo-router';
import {RoleGate} from '../../components/RoleGate';
export default function RiderLayout(){return <RoleGate roles={['rider']}><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:'transparent'}}}/></RoleGate>;}
