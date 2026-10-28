import React from 'react';
import {router} from 'expo-router';
import {EmptyState} from '../components/ui';
export default function NotFound(){return <EmptyState title="This bite wandered off." description="That page isn’t on our menu. Let’s get you back to something delicious." action="Back to BunkIn" onPress={()=>router.replace('/')}/>;}
