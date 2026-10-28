import { Role } from './types';

/** Roles whose accounts are issued by the restaurant owner. They can never self-register. */
export const staffRoles: Role[] = ['owner', 'manager', 'rider'];
export const kitchenRoles: Role[] = ['owner', 'manager'];

export const isStaff = (role?: Role | null): boolean => !!role && role !== 'customer';
export const canAccess = (role: Role | null | undefined, allowed: Role[]): boolean => !!role && allowed.includes(role);

/** Where each role lands after signing in. */
export function homePath(role?: Role | null): string {
 if (role === 'owner' || role === 'manager') return '/owner';
 if (role === 'rider') return '/rider';
 return '/';
}

export const roleLabel: Record<Role, string> = { customer: 'Customer', owner: 'Owner', manager: 'Manager', rider: 'Rider' };

/** Passwords chosen by staff after their first sign-in. */
export const MIN_STAFF_PASSWORD = 10;
