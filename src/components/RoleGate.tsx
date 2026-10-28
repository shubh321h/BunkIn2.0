import React from 'react';
import { Redirect, router } from 'expo-router';
import { useApp } from '../context/AppContext';
import { canAccess, roleLabel } from '../lib/roles';
import { Role } from '../lib/types';
import { EmptyState } from './ui';
/** UX gate only. The backend must enforce the same rules on every request. */
export function RoleGate({roles,children}:{roles:Role[];children:React.ReactNode}){
 const {profile,sessionReady}=useApp();
 if(!sessionReady)return <EmptyState title="Checking your workspace…" description="Verifying your signed-in account."/>;
 if(!profile)return <EmptyState icon="lock-closed-outline" title="This workspace is private" description="Sign in with the credentials your restaurant gave you." action="Sign in" onPress={()=>router.push('/auth')}/>;
 if(profile.mustChangePassword)return <Redirect href="/change-password"/>;
 if(!canAccess(profile.role,roles))return <EmptyState icon="shield-checkmark-outline" title="This area is not part of your role" description={`You are signed in as ${roleLabel[profile.role].toLowerCase()}. Ask the restaurant owner if you need different access.`} action="Back" onPress={()=>router.push('/')}/>;
 return <>{children}</>;
}
