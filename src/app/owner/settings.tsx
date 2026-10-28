import React from 'react';
import {RoleGate} from '../../components/RoleGate';
import {OwnerSettings} from '../../screens/OwnerScreens';
export default function SettingsRoute(){return <RoleGate roles={['owner']}><OwnerSettings/></RoleGate>;}
