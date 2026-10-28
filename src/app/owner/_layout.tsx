import React from 'react';
import {Stack} from 'expo-router';
import {RoleGate} from '../../components/RoleGate';
import {kitchenRoles} from '../../lib/roles';
export default function OwnerLayout(){return <RoleGate roles={kitchenRoles}><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:'transparent'}}}/></RoleGate>;}
