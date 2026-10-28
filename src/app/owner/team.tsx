import React from 'react';
import {RoleGate} from '../../components/RoleGate';
import {OwnerTeam} from '../../screens/OwnerScreens';
export default function TeamRoute(){return <RoleGate roles={['owner']}><OwnerTeam/></RoleGate>;}
