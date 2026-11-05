import React from 'react';
import {RoleGate} from '../../components/RoleGate';
import {OwnerOffers} from '../../screens/OwnerScreens';
export default function OffersRoute(){return <RoleGate roles={['owner']}><OwnerOffers/></RoleGate>;}
