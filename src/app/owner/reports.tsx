import React from 'react';
import {RoleGate} from '../../components/RoleGate';
import {OwnerReports} from '../../screens/OwnerScreens';
export default function ReportsRoute(){return <RoleGate roles={['owner']}><OwnerReports/></RoleGate>;}
